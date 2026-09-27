# 2 · The syntax, explained

> Every piece of TypeScript and JavaScript punctuation used in this project, with a real line from the codebase beside it. Skip this chapter if it is already familiar and come back when a symbol looks strange.

## TypeScript in ninety seconds

TypeScript is JavaScript with labels on the data. You write what *kind* of value something is, and the compiler tells you when you have made a mistake before the program runs.

```
// JavaScript — nothing stops this
function addDays(date, count) { ... }
addDays(7, "2026-09-01")        // arguments in the wrong order. Runs. Breaks later.

// TypeScript — the mistake is caught immediately
function addDays(date: string, count: number) { ... }
addDays(7, "2026-09-01")        // error before it ever runs
```

The annotations are *erased* before the code runs. Node strips `: string` and `: number` out and runs plain JavaScript. The types exist only while you are writing.

### `type` — giving a shape a name

```
export type Slot = {
  date: string;
  week_no: number;
};
```

That says: "a `Slot` is an object with a `date` which is text, and a `week_no` which is a number." Now `Slot[]` means "an array of those", and if you write `slot.dat` by mistake, you are told.

Used all over the planner, because the planner is mostly about moving well-defined shapes around.

### Union types — "one of these"

```
status: "planned" | "conducted" | "cancelled";
```

The `|` means *or*. This field cannot hold `"Conducted"` or `"done"` or `"planed"` — only those three exact strings. This mirrors the `check` constraint in the database, so a typo is caught twice: once by TypeScript and once by PostgreSQL.

### `?` on a property — optional

```
export type ReplanInput = {
  today: string;
  extraDates?: string[];     // may be left out entirely
};
```

`extraDates?` means the caller does not have to provide it. Inside the function its type is `string[] | undefined`, which is why the code immediately does `input.extraDates ?? []`.

### Generics — `<T>`

```
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>
```

`<T>` is a placeholder for "whatever type the caller's function returns". If your function returns a course, `transaction` returns a course. If it returns a number, `transaction` returns a number. Without generics you would have to write `any` and lose all type checking through the transaction.

Read that signature aloud: "transaction takes a function, which is given a client and returns a promise of T, and transaction itself returns a promise of T."

### `Record<K, V>` — an object used as a lookup

```
weightage: Record<string, number>;
```

"An object whose keys are strings and whose values are numbers", like `{ quiz: 15, final: 45 }`.

!WARN `Record` does not check that a key *exists*. `weightage["typo"]` type-checks fine and returns `undefined` at runtime. That is exactly why the grading code writes `weightage[component] ?? 0` instead of trusting it.

PAGEBREAK

## Modern JavaScript used throughout

### `async` / `await` — waiting without callbacks

Talking to a database takes time. `await` says "pause here until the answer arrives, then carry on".

```
const result = await pool.query("select * from course where id = $1", [courseId]);
const course = result.rows[0];
```

Without `await`, `result` would be a *promise* — an IOU, not the rows — and `result.rows` would be `undefined`. A function containing `await` must be declared `async`.

The important consequence: an `async` function always returns a promise, so the caller must `await` it too. That is why almost every function in `services/` is `async` and every route handler is `async`.

### `??` — the null-coalescing operator

"Use the left side, unless it is `null` or `undefined`, in which case use the right side."

```
const run = client ?? pool;              // use the transaction client if given, else the pool
const extraDates = input.extraDates ?? [];   // an empty array if nothing was passed
```

It is different from `||` in a way that matters here:

```
0 || 10     // -> 10   ... wrong! zero is a legitimate value
0 ?? 10     // -> 0    ... correct
```

Since this codebase deals in marks and percentages, where `0` is a real answer, `??` is used and `||` is avoided.

### `?.` — optional chaining

"Look inside this, but if it is missing, give me `undefined` instead of crashing."

```
const topicId = conducted.rows[0]?.topic_id;
```

If the update matched no rows, `rows[0]` is `undefined`. Plain `rows[0].topic_id` would throw *Cannot read properties of undefined*. With `?.` the whole expression is simply `undefined`, and the next line checks for that.

### `!` — the non-null assertion

"I know TypeScript thinks this could be missing. It cannot be. Trust me."

```
ok(res, await listCourses(req.auth!.userId));
```

TypeScript declares `req.auth` as optional, because on most requests it is. But this route sits behind `requireAuth`, which either sets `req.auth` or throws — so by the time this line runs it is always there. The `!` says so.

!WARN `!` turns off a safety check. It is correct here because `requireAuth` guarantees it, and it would be a bug anywhere that guarantee does not hold. It is the one symbol in this project that deserves a second look every time you type it.

### Destructuring — unpacking in one line

```
const { name, code, semester, start_date, end_date, class_days } = req.body;
```

Instead of six lines of `const name = req.body.name;`. It also works on function parameters:

```
const { today, startDate, endDate, classDays, holidays } = input;
```

### Spread — `...`

Two different jobs depending on where it appears.

*Copying and overriding an object:*

```
return { ...r, total_marks: Number(r.total_marks) };
```

"Everything from `r`, but with `total_marks` replaced by a number." The original `r` is untouched — a new object is made. Used constantly when converting what PostgreSQL returns into what the API sends.

*Copying an array before sorting:*

```
const ordered = [...topics].sort((a, b) => a.order_no - b.order_no);
```

`.sort()` sorts *in place* — it modifies the array you give it. In a pure function that would be a side effect on the caller's data. `[...topics]` makes a copy first, so the caller's array is left exactly as it was.

PAGEBREAK

### Array methods

These replace almost every `for` loop in the codebase.

| Method | What it gives back | Example from the code |
|---|---|---|
| `.map()` | A new array, same length, each item transformed | `sessions.map((s) => s.date)` |
| `.filter()` | A new array with only the items that pass a test | `sessions.filter((s) => s.status === "conducted")` |
| `.find()` | The first matching item, or `undefined` | `remaining.find((r) => r.id === t.id)` |
| `.some()` | `true` if at least one item passes | `result.overflow.some((o) => o.id === t.id)` |
| `.reduce()` | One value built up from all of them | `totals.reduce((sum, t) => sum + t, 0)` |
| `.sort()` | The same array, reordered | `bands.sort((a, b) => b.min_percentage - a.min_percentage)` |
| `.flatMap()` | Like `.map()`, then flattened one level | `s.components.flatMap((c) => c.missing)` |

`.reduce()` is the one worth reading slowly:

```
const needed = topicsRemaining.reduce((total, t) => total + t.sessions_needed, 0);
```

Start `total` at `0`. For each topic, add its `sessions_needed` to the running total. Give back the final total. It is a summing loop written as one expression.

### Comparison functions in `.sort()`

`.sort()` needs to know which of two items comes first. You give it a function that returns a negative number, zero, or a positive number.

```
// smallest first
(a, b) => a.order_no - b.order_no

// largest first — just swap the operands
(a, b) => b.min_percentage - a.min_percentage
```

And for two levels of sorting, "if the first comparison is a tie, fall back to the second":

```
const candidates = [...topics].sort((a, b) => {
  const byPriority = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  return byPriority !== 0 ? byPriority : b.order_no - a.order_no;
});
```

Lowest priority first; and between two topics of the same priority, the later one in the course goes first.

### `Map` and `Set`

A plain object can be used as a lookup, but `Map` and `Set` are clearer and faster for this.

*`Set` — a bag of unique values, for fast "is it in there?" checks:*

```
const isHoliday = new Set(holidays);
...
if (teaches.has(dayName) && !isHoliday.has(date)) { ... }
```

Checking `.has()` on a `Set` is instant no matter how many holidays there are. `holidays.includes(date)` would scan the whole array each time, once per day of a four-month semester.

*`Map` — key to value, where the key can be anything:*

```
const markBy = new Map<string, GradingMark>();
for (const m of marks) {
  markBy.set(`${m.student_id}:${m.assessment_id}`, m);
}
// later, instantly:
const mark = markBy.get(`${student.id}:${assessment.id}`);
```

Without this, finding one student's mark for one assessment would mean searching the whole marks array — for 42 students times 8 assessments, that is 336 searches through hundreds of rows. The `Map` turns all of it into direct lookups.

### Template literals — backticks

```
`${m.student_id}:${m.assessment_id}`
```

Backticks let you drop values into a string with `${...}`, and let the string span multiple lines. Every SQL query in this project is written in backticks so it can be laid out and indented like SQL rather than squashed onto one line.

### `for...of` versus `for...in`

```
for (const topic of ordered) { ... }      // each ITEM  <- what we use
for (const key in someObject) { ... }     // each KEY
```

`for...of` walks the values of an array. `for...in` walks the keys of an object. Mixing them up is a classic bug; this codebase uses `for...of` for arrays and `Object.entries()` for objects.

### `Object.entries()` — looping over an object

```
Object.entries(results.summary.grade_distribution)
  .filter(([, count]) => count > 0)
  .map(([grade, count]) => `${grade}: ${count}`)
  .join("   ");
```

`Object.entries({A: 3, B: 5})` gives `[["A", 3], ["B", 5]]` — an array of key/value pairs, which the normal array methods can then work on. The `[grade, count]` in the arrow function is destructuring each pair. The `[, count]` in the filter skips the first element because it is not needed.

PAGEBREAK

## Two Express-specific things that will bite

### An error handler is recognised by having exactly four parameters

```
// ORDINARY middleware — three parameters
export function notFoundHandler(req: Request, res: Response) { ... }

// ERROR handler — FOUR parameters
export function errorHandler(err, _req, res, _next) { ... }
```

Express decides which is which by counting the parameters. Delete the unused `_next` from the error handler and Express silently reclassifies it as ordinary middleware: it stops running on errors, and every failed request hangs forever with no response.

That is why `_next` is there and why it is named with an underscore — the underscore is a convention meaning "required by the signature, deliberately unused", and it also stops TypeScript complaining.

### In Express 5, a thrown error in an `async` route is caught for you

```
router.get("/:courseId", requireAuth, async (req, res) => {
  ok(res, await getCourse(pathId(req.params, "courseId"), req.auth!.userId));
});
```

There is no `try`/`catch` anywhere in that route, and there is none in any route in this project. If `getCourse` throws — because the course does not exist, or the database is down — Express 5 catches it and hands it to `errorHandler`.

In Express 4 this was not true: an async throw would crash the process, and every route needed its own `try`/`catch` or a wrapper. Express 5 fixing this is why the routes in this codebase are three lines long.

!NOTE This is the single most important reason the routes are readable. A route describes the happy path only. Every failure goes to one place.

### `req.params` is not type-checked

```
req.params.courseIdd     // TypeScript is perfectly happy. It is `undefined` at runtime.
```

TypeScript cannot know what parameter names a route declares, so `req.params` is an open bag of strings. A typo in the name compiles fine and then sends the literal string `"undefined"` to the database.

That is why every route in this project reads parameters through a helper:

```
pathId(req.params, "courseId")
```

which throws a clear `400 courseId is missing from the URL` instead. Chapter 5 shows the implementation. This bug was hit twice while building the project, which is why the helper exists.
