# 3 · The database

> Sixteen tables, what each one holds, and why three of the design decisions are the way they are. Then the SQL techniques used, each explained from zero.

## How migrations work here

There is no migration tool. A migration is a numbered `.sql` file in `migrations/`, run by hand:

```
psql "$DATABASE_URL" -f migrations/001_init.sql
psql "$DATABASE_URL" -f migrations/002_makeup_date.sql
```

Each file is wrapped in `begin; ... commit;` so it either applies completely or not at all. If a `create table` halfway down fails, the tables above it are rolled back too and you are left exactly where you started, rather than with half a schema.

Files are never edited after being applied. A change is a new numbered file.

## The tables, grouped

### Identity

| Table | Holds |
|---|---|
| `teacher` | One row per signed-in teacher. Its `id` is the Supabase user id |
| `course` | Name, code, semester, start and end dates, class days, attendance threshold |

### Course setup

| Table | Holds |
|---|---|
| `topic` | One row per topic: title, order, how many classes it needs, its minimum, priority, status |
| `holiday` | Dates class cannot happen. Preloaded, with an `is_active` flag the teacher toggles |
| `makeup_date` | Extra dates the teacher agreed to, outside the normal class days |

### The plan — the backbone of the app

| Table | Holds |
|---|---|
| `session` | *One row per class.* Date, week number, which topic, which part of it, and its status |
| `replan_log` | A record of every replan: when, why, and what moved |

### People

| Table | Holds |
|---|---|
| `student` | Roll number and name. Belongs to the *teacher*, not to one course |
| `enrollment` | Which student is in which course |
| `attendance` | One row per student per class: present, absent or leave |

### Assessment and marks

| Table | Holds |
|---|---|
| `assessment` | A quiz, assignment, midterm, final or participation mark. Total marks, date |
| `assessment_topic` | Which topics an assessment covers — the planner needs this |
| `mark` | What one student scored on one assessment |

### Grading and material

| Table | Holds |
|---|---|
| `weightage` | What percentage of the final result each component is worth |
| `grade_scale` | The letter grades and the minimum percentage for each |
| `material` | A pointer to a file in Supabase Storage. Never the file itself |

`session` is the table everything else hangs off. Attendance is per session. Topic progress is derived from sessions. Every report counts sessions. Which is why the planner was built first: once sessions exist, half the app becomes straightforward.

PAGEBREAK

## The three decisions worth defending

### 1 · `mark.obtained` is nullable and has no default

```
obtained numeric(6,2),          -- NULL = not entered. Never 0 by default.
is_absent boolean not null default false,
```

There are three genuinely different situations, and they must not be confused:

| Situation | `obtained` | `is_absent` | Counts as |
|---|---|---|---|
| Teacher has not typed it yet | `NULL` | `false` | *Missing.* Left out of the calculation |
| Student sat it and scored nothing | `0` | `false` | A real zero |
| Student did not sit it | `NULL` | `true` | A real zero |

If `obtained` defaulted to `0`, the first row would be indistinguishable from the second. A teacher halfway through entering the final exam would be looking at a screen full of students who appear to have failed.

!WARN This is the one schema detail most likely to get "tidied up" by someone adding `not null default 0` to make the code simpler. It would silently change grades. The tests in `tests/grading.test.ts` exist partly to catch that.

### 2 · A student belongs to the teacher, not to the course

```
create table student (
  teacher_id uuid not null references teacher(id) on delete cascade,
  roll_no    text not null,
  name       text not null,
  unique (teacher_id, roll_no)
);
```

The obvious design would put `course_id` on `student`. It was rejected because the same student takes several of the same teacher's courses. With `course_id` on the student you would get a duplicate row per course, and correcting a misread name would have to be done in each one.

Instead `student` holds the person once, and `enrollment` joins them to a course. The `unique (teacher_id, roll_no)` is what makes re-importing a class list safe: the second import matches the existing student rather than creating a twin.

### 3 · `session.status` drives everything

```
status text not null default 'planned'
  check (status in ('planned', 'conducted', 'cancelled'))
```

Three values, and each one means something specific to the planner:

- `planned` — has not happened. The planner is free to delete and rebuild it.
- `conducted` — happened. *Never touched again.* This is "freeze the past".
- `cancelled` — was going to happen and did not. Kept as a record, not rebuilt, and deliberately *not* counted as a missed opportunity in the attendance percentage or the behind-schedule number.

That last point matters: if a cancelled class counted in the attendance denominator, students would lose attendance percentage because the *teacher* cancelled. The queries exclude cancelled classes for exactly that reason.

PAGEBREAK

## Constraints — letting the database refuse bad data

A `check` constraint is a rule PostgreSQL enforces itself. Even if a bug in the code tries to write nonsense, the database rejects it.

```
constraint course_dates_ck check (end_date > start_date),

constraint course_class_days_ck check (
  array_length(class_days, 1) between 1 and 7
  and class_days <@ array['mon','tue','wed','thu','fri','sat','sun']
),

constraint topic_min_le_needed_ck check (min_sessions <= sessions_needed)
```

Reading the second one: the class-days array must have between one and seven entries, and `<@` means "is contained by" — every value in `class_days` must appear in that list of seven day names. So `['mon','funday']` is rejected by the database.

There are 96 check constraints across the schema. They are the last line of defence, and they are checked *again* in the service code — not because the database check is unreliable, but because a raw constraint violation produces a message like `new row for relation "topic" violates check constraint "topic_min_le_needed_ck"`, and a teacher needs *"min_sessions (3) cannot be more than sessions_needed (2)"*.

### `unique` — refusing duplicates

```
unique (course_id, order_no)        -- two topics cannot both be topic 5
unique (assessment_id, student_id)  -- one mark per student per assessment
unique (session_id, student_id)     -- one attendance record per student per class
unique (teacher_id, roll_no)        -- one student row per roll number per teacher
```

A *composite* unique constraint like these means the combination must be unique, not each column on its own. Two different courses can both have a topic 5.

These are not just safety: the `on conflict` upsert pattern described below depends on them existing.

### Foreign keys and `on delete`

```
course_id bigint not null references course(id) on delete cascade
topic_id  bigint          references topic(id)  on delete set null
```

`on delete cascade` — delete the course and every session, topic, holiday and enrollment goes with it. Correct for things that cannot exist without their parent.

`on delete set null` — delete a topic and the sessions survive with `topic_id` set to `NULL`. Correct here because a class that was *taught* still happened even if the topic record is later removed; losing the attendance attached to it would be worse than losing the topic label.

---

## The SQL techniques used, from zero

The project uses raw SQL by choice, and it uses a handful of PostgreSQL features that are worth understanding properly because they appear repeatedly.

### `$1`, `$2` — parameters, and why they are not optional

```
await pool.query(
  "select id from course where id = $1 and teacher_id = $2",
  [courseId, req.auth!.userId],
);
```

The `$1` and `$2` are placeholders. The values are sent *separately* from the query text, so PostgreSQL never mixes the two up.

Compare the wrong way:

```
// NEVER do this
`select id from course where id = ${courseId}`
```

If `courseId` arrived from the app as `1; drop table course; --`, the second version hands PostgreSQL three statements and the table is gone. That is SQL injection. With `$1`, the value is only ever data — PostgreSQL treats it as the text `"1; drop table course; --"`, finds no course with that id, and returns nothing.

Every single query in this project uses parameters. There is no string interpolation of user input anywhere.

!NOTE There is one place where a value is put into the query text directly: `update course set ${sets.join(", ")}`. Look closely and the `sets` array only ever contains strings the *code* built, like `"name = $2"` — the column names come from a fixed list in the code, and the values are still `$2`, `$3` and so on. User input never reaches the query text.

PAGEBREAK

### `unnest` — turning arrays into rows

This is the single most useful trick in the project. It is what makes it possible to insert forty rows with one statement.

The problem: the teacher pastes fourteen topic titles. The obvious code is a loop:

```
for (const title of titles) {
  await client.query("insert into topic (course_id, title) values ($1, $2)", [courseId, title]);
}
```

Fourteen separate round trips to a database in Mumbai. At 60ms each that is nearly a second of waiting.

`unnest` takes an array and turns it into rows:

```
select unnest(array['SQL', 'Joins', 'Normalization']);

  unnest
---------------
 SQL
 Joins
 Normalization
```

So the whole insert becomes one statement:

```
insert into topic (course_id, order_no, title)
select $1, ordinality, title
  from unnest($2::text[]) with ordinality as t(title, ordinality)
```

Reading it piece by piece:

- `$2::text[]` — the second parameter, explicitly cast to an array of text. `pg` sends a JavaScript array as a PostgreSQL array, and the `::text[]` tells PostgreSQL which kind.
- `unnest(...)` — turn that array into one row per title.
- `with ordinality` — *also* give me the position number, 1, 2, 3. This is exactly what `order_no` needs, and it means the order the teacher typed is preserved without the code counting.
- `as t(title, ordinality)` — name the two resulting columns so the `select` above can use them.
- `select $1, ordinality, title` — build each row: the same course id every time, the position, the title.

One round trip. Fourteen rows.

*Two arrays at once*, which is how holidays are inserted with their names:

```
insert into holiday (course_id, date, name)
select $1, h.date, h.name
  from unnest($2::date[], $3::text[]) as h(date, name)
```

`unnest` with two arrays walks them in step: first date with first name, second with second. The code builds the two arrays with `.map()` and they line up because `.map()` preserves order.

The biggest one in the project unnests six arrays at once, to write a whole semester of sessions:

```
insert into session (course_id, topic_id, date, week_no, part_no, total_parts, kind)
select $1, t.topic_id, t.date, t.week_no, t.part_no, t.total_parts, t.kind
  from unnest($2::bigint[], $3::date[], $4::int[], $5::int[], $6::int[], $7::text[])
    as t(topic_id, date, week_no, part_no, total_parts, kind)
```

Thirty sessions, one statement.

### `on conflict` — insert, or update if it is already there

Also called an *upsert*. The teacher opens the attendance screen a second time and fixes a mistake; the row already exists.

```
insert into attendance (session_id, student_id, status)
select ...
on conflict (session_id, student_id) do update
   set status = excluded.status,
       marked_at = now()
```

- `on conflict (session_id, student_id)` — "if inserting would break the unique constraint on these two columns".
- `do update set ...` — "then update the existing row instead of failing".
- `excluded` — a special name meaning *the row I was trying to insert*. So `excluded.status` is the new status.

The alternative is a `select` to check, then either an `insert` or an `update` — three statements, and a race if two requests arrive at once. `on conflict` is one statement and the database handles the race.

`do nothing` is the other option, used where an existing row should be left exactly as it is:

```
insert into holiday (course_id, date, name)
select ...
on conflict (course_id, date) do nothing
```

When the semester is extended, this tops up any newly-exposed public holidays without resetting the ones the teacher already ticked or unticked.

PAGEBREAK

### `update ... from unnest(...)` — many different updates in one statement

The holiday screen sends back a list of `{ id, is_active }`. Every row may have a different value, so a single `set is_active = $1` will not do.

```
update holiday h
   set is_active = v.is_active
  from unnest($2::bigint[], $3::boolean[]) as v(id, is_active)
 where h.id = v.id and h.course_id = $1
```

`unnest` builds a temporary two-column table of id/value pairs, and the `where` joins each holiday to its own new value. Eight different updates, one round trip.

The `and h.course_id = $1` is not decoration — without it, someone could send holiday ids belonging to another teacher's course and change them.

### `count(*) filter (where ...)` — several counts in one pass

```
select count(*) filter (where status = 'conducted') as conducted,
       count(*) filter (where status = 'cancelled') as cancelled,
       count(*) filter (where status = 'planned')   as planned
  from session where course_id = $1
```

Without `filter` this would be three separate queries, each scanning the table. With it, PostgreSQL walks the rows once and keeps three counters.

Used all over the dashboard and the attendance summary.

### CTEs — `with ... as (...)`

A *common table expression* names a result so the rest of the query can use it, which keeps a complicated query readable.

```
with conducted as (
  select id from session where course_id = $1 and status = 'conducted'
)
select s.roll_no,
       count(a.id) filter (where a.status = 'present') as present
  from enrollment e
  join student s on s.id = e.student_id
  left join attendance a on a.student_id = s.id
                        and a.session_id in (select id from conducted)
 where e.course_id = $1
 group by s.id, s.roll_no
```

`conducted` is defined once at the top and referred to below. It reads as: "the classes that actually happened; now for each enrolled student, count their present marks among those classes."

### `left join` versus `join`

This distinction decides whether a student with no marks appears at all.

- `join` — only rows that have a match on both sides.
- `left join` — every row from the left side, with `NULL`s where the right side has no match.

```
from enrollment e
join student s on s.id = e.student_id          -- every enrollment HAS a student
left join mark m on m.student_id = s.id        -- a student may have NO marks yet
               and m.assessment_id = $1
```

The marks-entry screen needs *every* student in the class, including the ones not yet marked — otherwise the teacher could not enter their mark. So `mark` is joined with `left join`, and the code reads `m.obtained` as `null` for those students.

Using a plain `join` there would quietly hide exactly the students the teacher still has work to do on.

### `coalesce` — a fallback for `NULL`

```
coalesce(a.status, 'present') as status
coalesce(array_agg(at.topic_id) filter (where at.topic_id is not null), '{}') as topic_ids
```

`coalesce(x, y)` gives `x` unless it is `NULL`, in which case `y`.

The first line implements present-by-default on the attendance screen: a student with no attendance row shows as present.

The second is defensive: `array_agg` over no rows returns `NULL`, not an empty array, and `NULL` would crash the JavaScript that maps over it. `'{}'` is an empty PostgreSQL array.

### `to_char(date, 'YYYY-MM-DD')` — dates as plain text

```
select to_char(start_date, 'YYYY-MM-DD') as start_date
```

Every date is read out of the database as a formatted string rather than a date type.

The reason is timezones. `pg` converts a PostgreSQL `date` into a JavaScript `Date`, which is a moment in time in *your* timezone. A course starting `2026-09-01` becomes midnight local, and depending on the server's timezone that can print as 31 August. The planner then generates a slot on the wrong day.

Turning it into the string `"2026-09-01"` before it leaves the database removes the problem entirely. The planner works in strings throughout, and string comparison on `YYYY-MM-DD` sorts correctly by date — which is why the code can write `if (s.date <= today)` and be right.

!NOTE This pairs with the planner using `Date.UTC` internally. Both halves of the system refuse to let a local timezone anywhere near a calendar date. Chapter 6 covers the planner side.

### `numeric` and `Number()`

PostgreSQL `numeric` is an exact decimal type — the right choice for marks and percentages, because floating point cannot represent `0.1` exactly and grades should not drift.

`pg` returns `numeric` as a *string*, precisely so no precision is lost on the way out. That is why service code is full of:

```
total_marks: Number(r.total_marks),
obtained: r.obtained === null ? null : Number(r.obtained),
```

The second line matters: `Number(null)` is `0`, so a plain `Number(r.obtained)` would turn every un-entered mark into a zero — the exact bug the nullable column was designed to prevent. The explicit `null` check keeps it `null`.
