# 8 · The services

> The only layer that touches the database. Eleven files. Each one loads data, calls a pure function or writes SQL, and returns plain data — never an HTTP response.

## The shape every service follows

```
1. ASSERT OWNERSHIP     assertCourseOwned(courseId, teacherId)
2. VALIDATE THE INPUT   throw badRequest("...") on anything wrong
3. LOAD                 select ...
4. THINK                call the pure planner or grading function
5. SAVE                 insert / update, inside a transaction if more than one statement
6. RETURN               plain data. No res.json anywhere in this folder.
```

A service never sees `req` or `res`. It takes ordinary arguments and returns ordinary values, which is what lets `dashboard.service.ts` call three other services directly and `scripts/seed.ts` call them all from a terminal with no server running.

---

## `plan.service.ts` — load, think, save

The largest and most important service. It is the bridge between the pure planner and the database.

### The load helpers

Five small functions, each reading one thing. They share a pattern:

```
async function loadTopics(courseId: string, client?: PoolClient): Promise<PlannerTopic[]> {
  const run = client ?? pool;
  const result = await run.query(
    `select id, order_no, title, sessions_needed, min_sessions, priority
       from topic
      where course_id = $1 and status <> 'dropped'
      order by order_no`,
    [courseId],
  );
  return result.rows.map((r) => ({
    id: Number(r.id),
    order_no: r.order_no,
    ...
  }));
}
```

- `client?: PoolClient` and `const run = client ?? pool` — the same function works inside a transaction or outside one. Called with a client it joins the transaction; called without, it borrows from the pool. Without this the code would need two copies of every loader.
- `status <> 'dropped'` — a topic the teacher dropped through the deficit screen must not come back the next time the planner runs.
- `Number(r.id)` — `bigint` comes back from `pg` as a string, and the planner's types say `number`.

### `generatePlan` — the before-the-semester path

```
export async function generatePlan(courseId, teacherId, options: { reset?: boolean } = {}) {
  const course = await assertCourseOwned(courseId, teacherId);

  const conducted = await pool.query(
    `select count(*)::int as n from session where course_id = $1 and status <> 'planned'`,
    [courseId],
  );
  const alreadyHappened = conducted.rows[0]?.n ?? 0;

  if (alreadyHappened > 0 && options.reset !== true) {
    throw badRequest(
      `This course already has ${alreadyHappened} class(es) marked conducted or cancelled. ` +
      `Use POST /courses/${courseId}/plan/replan to rebuild the future without touching them, ` +
      `or send { "reset": true } to start the whole plan over ...`,
    );
  }

  return transaction(async (client) => {
    if (options.reset === true) {
      await client.query(`delete from session where course_id = $1`, [courseId]);
    }

    const topics = await loadTopics(courseId, client);
    const holidays = await loadActiveHolidays(courseId, client);
    const makeupDates = await loadMakeupDates(courseId, client);

    // THINK
    const regular = generateSlots(course.start_date, course.end_date, course.class_days, holidays);
    const slots = mergeExtraDates(regular, makeupDates, course.start_date);
    const { sessions, overflow, unusedSlots } = allocateTopics(slots, topics);

    // SAVE
    await writeSessions(client, courseId, sessions, new Set(makeupDates));

    const assessments = await loadAssessments(courseId, client);
    const titles = new Map(topics.map((t) => [t.id, t.title]));
    const moves = validateAssessmentDates(sessions, slots, assessments, titles);
    await applyAssessmentMoves(client, moves);

    return { sessions, overflow, assessments_moved: moves, slots_total: slots.length,
             slots_unused: unusedSlots.length, deficit: calculateDeficit(slots.length, overflow) };
  });
}
```

The guard at the top was added because of a bug the smoke test found. `generate` lays out every topic across *every* slot from the start date. Run mid-semester, it would schedule a fresh class on a date that already holds a conducted one, and it would ignore teaching that has already happened. So it refuses, and the error message names the endpoint to use instead.

`reset: true` is the deliberate escape hatch. It deletes conducted classes and — through `on delete cascade` — their attendance, so it demands an explicit flag rather than being the default.

### `writeSessions` — replacing the future

```
async function writeSessions(client, courseId, sessions: PlannedSession[],
                             makeupDates: Set<string> = new Set()) {
  await client.query(`delete from session where course_id = $1 and status = 'planned'`, [courseId]);

  if (sessions.length === 0) return;

  await client.query(
    `insert into session (course_id, topic_id, date, week_no, part_no, total_parts, kind)
     select $1, t.topic_id, t.date, t.week_no, t.part_no, t.total_parts, t.kind
       from unnest($2::bigint[], $3::date[], $4::int[], $5::int[], $6::int[], $7::text[])
         as t(topic_id, date, week_no, part_no, total_parts, kind)`,
    [courseId, sessions.map((s) => s.topic_id), sessions.map((s) => s.date), ...
     sessions.map((s) => (makeupDates.has(s.date) ? "makeup" : "regular"))],
  );
}
```

- `and status = 'planned'` — this clause *is* "freeze the past". Conducted and cancelled rows are not in the delete, so they survive every rebuild.
- `if (sessions.length === 0) return` — `unnest` on empty arrays produces no rows, so this is only a small saving, but it also avoids a pointless round trip.
- The whole rebuild is one delete and one insert, inside a transaction. A crash between them leaves the old plan intact.

### `replanCourse` — freeze the past, rebuild the future

Same shape, but it loads the existing sessions, passes everything to `replan()`, and then writes a record of what happened:

```
await client.query(
  `insert into replan_log (course_id, reason, changes) values ($1, $2, $3)`,
  [courseId, reason, JSON.stringify({ changes: result.changes, assessments_moved: moves })],
);
```

`replan_log.changes` is a `jsonb` column, so the whole change list is stored as JSON in one field rather than being spread over a table of its own. It is a log — written once, read back whole for the course report — so a structured column would have been more work for no benefit.

PAGEBREAK

### `getDeficitOptions` and the makeup-date problem

The interesting part of `applyDeficitChoice` is where an agreed makeup date gets stored.

The first attempt wrote makeup dates as `session` rows. That was wrong, and the reason is worth understanding: every replan starts by deleting the planned sessions. So the makeup date would be created, used once, and then silently deleted on the next replan — and since `generateSlots` only ever produces normal class days, it could never be rediscovered. The teacher's decision would quietly evaporate.

Hence `migrations/002_makeup_date.sql`:

```
create table makeup_date (
  id         bigserial primary key,
  course_id  bigint not null references course(id) on delete cascade,
  date       date   not null,
  reason     text,
  created_at timestamptz not null default now(),
  unique (course_id, date)
);
```

An agreed date is stored *once*, permanently, and every later replan reads it back and feeds it to the planner as an extra slot. The tests `an agreed makeup date becomes a usable class slot` and `a makeup date in the past is not offered as a future slot` cover both directions.

---

## `session.service.ts` — marking a class conducted or cancelled

### Topic status is derived, never set by hand

```
export async function refreshTopicStatus(client, topicId: string): Promise<void> {
  await client.query(
    `update topic t
        set status = case
              when t.status = 'dropped'             then 'dropped'
              when counts.conducted = 0             then 'pending'
              when counts.conducted >= counts.total then 'completed'
              else 'in_progress'
            end
       from (
         select count(*) filter (where status = 'conducted')  as conducted,
                count(*) filter (where status <> 'cancelled') as total
           from session where topic_id = $1
       ) as counts
      where t.id = $1`,
    [topicId],
  );
}
```

A topic's status is *computed from its sessions* every time one changes. Nothing in the app ever sets it to `completed` directly.

If it were set by hand it would drift: cancel a class after marking the topic complete, and the topic is now wrong with nothing to correct it. Deriving it means it cannot be wrong.

- `when t.status = 'dropped' then 'dropped'` — a dropped topic is a deliberate teacher decision and is left alone.
- `count(*) filter (where status <> 'cancelled')` — the denominator excludes cancelled classes, so a topic whose last class was cancelled can still reach `completed`.
- `from (select ...) as counts` — a subquery in the `from` clause of an `update`, so the counts and the update happen in one statement.

### The bug this exposed

`refreshTopicStatus` was originally called only from `updateSession` — the `PATCH /sessions/:id` path. But most classes are marked conducted by *taking attendance*, which has its own `update session` statement.

The seed script made it obvious: 19 classes conducted, and the dashboard reported *7% of the syllabus covered*. Only one topic had ever been updated.

The fix was to call it from the attendance path too:

```
const conducted = await client.query(
  `update session set status = 'conducted', updated_at = now()
    where id = $1 and status = 'planned'
    returning topic_id`,
  [sessionId],
);

const topicId = conducted.rows[0]?.topic_id;
if (topicId !== undefined && topicId !== null) {
  await refreshTopicStatus(client, String(topicId));
}
```

After the fix: 57%, which matches 8 of 14 topics.

!NOTE This is a good example of why the seed script matters. The bug was invisible in unit tests — the pure functions were all correct. It only appeared once a realistic semester of data existed and a number looked wrong.

---

## `attendance.service.ts` — present by default

### One statement marks the whole class

The app sends only the absentees. Everyone else is present.

```
insert into attendance (session_id, student_id, status)
select $1,
       e.student_id,
       case
         when e.student_id = any($3::bigint[]) then 'absent'
         when e.student_id = any($4::bigint[]) then 'leave'
         else 'present'
       end
  from enrollment e
 where e.course_id = $2
on conflict (session_id, student_id) do update
   set status = excluded.status, marked_at = now()
returning student_id, status
```

- The `select ... from enrollment` drives the insert: one row per enrolled student, automatically. The code never has to know the class list.
- `= any($3::bigint[])` — "is this student id in the absent array?" This is how you test membership of an array in PostgreSQL.
- `case ... else 'present'` — the default, expressed in SQL rather than in a loop.
- `on conflict ... do update` — reopening the screen and fixing a mistake just overwrites.

For 42 students that is one round trip instead of 42.

### Cancelled classes and leave are excluded from the percentage

```
with conducted as (
  select id from session where course_id = $1 and status = 'conducted'
)
select ...
       case
         when count(a.id) filter (where a.status <> 'leave') = 0 then null
         else round(100.0 * count(a.id) filter (where a.status = 'present')
                          / count(a.id) filter (where a.status <> 'leave'), 2)
       end as percentage
```

Two deliberate exclusions:

- *Only conducted classes count.* A cancelled class was never an opportunity to attend. Counting it would lower every student's percentage because the *teacher* cancelled.
- *Leave is excused.* A `leave` record is removed from the denominator entirely rather than counted as an absence — that is what makes it different from `absent`.

And `case ... then null` guards against dividing by zero before any class has happened. `null`, not `0` — a student with no record yet has no percentage, and showing `0%` would flag them as below threshold on day one.

`100.0` rather than `100` forces floating-point division. In PostgreSQL, `100 / 3` on integers is `33`.

PAGEBREAK

---

## `student.service.ts` — the reviewed class list

The teacher photographs the printed list, an extractor returns a draft, the teacher corrects it on screen, and *only then* does it reach this service.

### The server validates again, even though the screen did

```
function validateRows(value: unknown): ReviewedStudent[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw badRequest("students must be a non-empty array of { roll_no, name }");
  }

  const rows: ReviewedStudent[] = [];
  const seen = new Map<string, number>();

  value.forEach((row, index) => {
    const line = index + 1;
    const rollNo = typeof row?.roll_no === "string" ? row.roll_no.trim() : "";
    const name = typeof row?.name === "string" ? row.name.trim() : "";

    if (rollNo === "") throw badRequest(`Row ${line} has no roll number`);
    if (name === "") throw badRequest(`Row ${line} has no name`);

    const earlier = seen.get(rollNo.toUpperCase());
    if (earlier !== undefined) {
      throw badRequest(`Roll number ${rollNo} appears twice, on rows ${earlier} and ${line}`);
    }
    seen.set(rollNo.toUpperCase(), line);

    rows.push({ roll_no: rollNo, name });
  });

  return rows;
}
```

The review screen highlights these same problems. The checks are repeated here because *the screen is a convenience and the server is the rule* — an old build of the app, a second client, or a replayed request must not get past them.

*Duplicates are refused, never merged.* Two students with the same roll number means one was misread. Merging them would silently lose a student for the whole semester. The error names both row numbers so the teacher can see which two.

`rollNo.toUpperCase()` for the duplicate check, but the original casing is stored — so `ct-21001` and `CT-21001` are caught as the same student.

### The import itself

```
insert into student (teacher_id, roll_no, name)
select $1, r.roll_no, r.name
  from unnest($2::text[], $3::text[]) as r(roll_no, name)
on conflict (teacher_id, roll_no) do update set name = excluded.name
returning id, roll_no, name
```

Then a second statement enrolls them:

```
insert into enrollment (course_id, student_id)
select $1, id from unnest($2::bigint[]) as id
on conflict (course_id, student_id) do nothing
returning student_id
```

Both inside one transaction. Two statements for 42 students, and re-importing the list is safe: existing students are matched by roll number and have their names refreshed, and existing enrollments are left alone.

---

## `grading.service.ts` — marks in, results out

### Marks are validated against the total

```
if (value > totalMarks) {
  throw badRequest(`Row ${line}: obtained (${value}) is more than the total marks (${totalMarks})`);
}
```

A quiz out of 10 cannot have someone scoring 85 — that is a slipped keypad, and catching it at entry is far better than finding it in the final result.

### Clearing a mark is allowed and keeps it `null`

```
if (row.obtained !== undefined && row.obtained !== null && row.obtained !== "") {
  value = Number(row.obtained);
  ...
}
```

`value` starts as `null` and only becomes a number if something real was sent. So sending `null` or an empty string sets the mark back to *not entered* — a genuine thing a teacher needs to do after a mistake — and it stays `null` rather than becoming `0`.

### A student from another class cannot be marked

```
insert into mark (assessment_id, student_id, obtained, is_absent)
select $1, r.student_id, r.obtained, r.is_absent
  from unnest($2::bigint[], $3::numeric[], $4::boolean[])
    as r(student_id, obtained, is_absent)
  join enrollment e on e.student_id = r.student_id and e.course_id = $5
on conflict (assessment_id, student_id) do update ...
```

The `join enrollment` is the security check, done in SQL. A student id that is not enrolled in this course matches no row and is silently skipped rather than saved. The service reports how many were ignored:

```
return { saved: result.rowCount ?? 0, ignored: studentIds.length - (result.rowCount ?? 0), ... };
```

### Lazy seeding of weightage and grade scale

```
export async function getWeightage(courseId: string, teacherId: string) {
  await assertCourseOwned(courseId, teacherId);

  const existing = await pool.query(`select component, percentage from weightage where course_id = $1`, [courseId]);

  if (existing.rowCount === 0) {
    // insert the defaults, then return them
  }
  ...
}
```

Nothing is asked at course setup. The defaults appear the first time the grading screen is opened, already filled in, and the teacher corrects them from there. That is the minimum-input rule applied to a feature that would otherwise need a form nobody wants to fill in on day one.

PAGEBREAK

---

## `course.service.ts` — settings, topic edits and cloning

### `replan_required` — telling the app when the plan is stale

```
if (body.class_days !== undefined) { ... planAffected = true; }
if (body.start_date !== undefined || body.end_date !== undefined) { ... planAffected = true; }
...
return { ...course, replan_required: planAffected };
```

Changing the dates or the class days invalidates the timetable. Changing the course *name* does not. So the service tracks which kind of change happened and tells the app, which then shows a "your plan needs rebuilding" prompt.

The same flag comes back from `PATCH /topics/:id` when `sessions_needed`, `order_no` or `status` changes — exactly the triggers the spec names for replanning.

### Dynamic `set` clauses, built safely

```
const sets: string[] = [];
const values: unknown[] = [courseId];

const set = (column: string, value: unknown) => {
  values.push(value);
  sets.push(`${column} = $${values.length}`);
};

if (body.name !== undefined) { ...; set("name", name); }
if (body.code !== undefined) set("code", ...);
...

await client.query(
  `update course set ${sets.join(", ")}, updated_at = now() where id = $1 returning ...`,
  values,
);
```

`PATCH` should change only the fields that were sent, so the SQL has to be built at runtime.

The safety comes from what goes where: the *column names* are literals written in this file, and the *values* always become `$2`, `$3` and so on. `values.push` then `$${values.length}` keeps the numbering in step automatically — push the value first, and its position is the placeholder number.

User input never reaches the query text.

### Validating against the database's own rules first

```
if (nextMin > nextNeeded) {
  throw badRequest(`min_sessions (${nextMin}) cannot be more than sessions_needed (${nextNeeded})`);
}
```

The database would refuse this anyway through `topic_min_le_needed_ck`. Checking it here turns

```
error: new row for relation "topic" violates check constraint "topic_min_le_needed_ck"
```

into a sentence a teacher can act on. The constraint stays as the real guarantee; this is just a better error message.

### `cloneCourse` — what is copied and what is not

| Copied | Not copied |
|---|---|
| Topics, reset to `pending` | Students and enrollments |
| Weightage | Sessions |
| Grade scale | Attendance |
| Class days, threshold, code | Marks |

The rule: *the teacher's preparation is copied, the semester's history is not.* Topics and grading setup are the work nobody wants to redo. Students and marks belong to the semester that has ended.

Holidays are a special case — *recalculated* for the new dates rather than copied:

```
const holidays = holidaysBetween(startDate, endDate);
```

Eid moves every year. Copying last year's dates would put a holiday on the wrong day.

---

## `dashboard.service.ts` — every number in one response

The spec asks for one endpoint that returns everything the dashboard shows, so the app makes one request instead of six and stitching them together.

It works by calling other services:

```
const health = await getScheduleHealth(courseId, teacherId, today);
const attendance = await getAttendanceSummary(courseId, teacherId);
const results = hasStudents ? await getResults(courseId, teacherId) : null;
```

This is only possible because services take plain arguments and return plain data. If they wrote to `res` directly, none of this composition would work.

`hasStudents ? ... : null` — computing results for a course with no students is pointless, and it also avoids the grading engine running over an empty class on every dashboard load.

The warning sentence is assembled here rather than in the app, so every client shows the same wording:

```
warning: health.behind_by_weeks >= 0.5
  ? `You are ${health.behind_by_weeks} week${health.behind_by_weeks === 1 ? "" : "s"} behind your plan.`
  : null
```

The `week${... === 1 ? "" : "s"}` is the singular/plural fix — "1 week", "2 weeks".

---

## `report.service.ts` — everything except the drawing

The PDF *tool* is not chosen yet. What is finished is everything above it.

```
export type ReportDocument = {
  type: ReportType;
  title: string;
  header: ReportHeader;
  columns: string[];
  rows: (string | number | null)[][];
  summary: { label: string; value: string | number }[];
  notes: string[];
};
```

Every number, every row, every summary line and every footnote is computed — by the same functions the screens use. When a PDF library is picked, the only new code is "draw this object". There is nothing left for it to calculate, so the document cannot disagree with the app.

```
export async function renderReportPdf(_document: ReportDocument): Promise<Buffer> {
  throw new AppError(503,
    "PDF rendering is not configured yet. " +
    "Request the same report without .pdf to get the finished report as JSON.");
}
```

`503 Service Unavailable` is the honest status: the feature exists and is not available yet. And the message names the workaround, which actually works today — `GET /courses/3/reports/result` returns the complete report as JSON, and the preview screen can be built against it now.

All three reports are done: `result`, `attendance` and `course`. The result sheet names students with missing marks explicitly rather than hiding them, because the total beside them is provisional.
