# 11 · What is stubbed, and why

> Two features are deliberately unfinished. Both are unfinished in the same careful way: everything except the tool is done, so finishing them changes one function each.

## The two stubs

| Feature | File | Status | Answers |
|---|---|---|---|
| Document extraction | `src/services/extraction.service.ts` | Interface fixed, no tool chosen | `503` |
| PDF rendering | `src/services/report.service.ts` | Report data complete, no renderer | `503` |

Both are stubbed because the spec says so: *"Tool not decided yet, but the feature is required and fully owned by the app. Leave a stub with a clear interface until the tool is picked."*

## Why `503` and not `501` or `500`

`503 Service Unavailable` says the feature exists and is temporarily unavailable. That is exactly true. And both messages name a workaround that actually works:

```
"Class list extraction is not configured yet. Use the manual entry path on the
 review screen for now."

"PDF rendering is not configured yet. Request the same report without .pdf to
 get the finished report as JSON."
```

A `500` would suggest a bug. A silent empty response would have the mobile team debugging their own code.

## The extraction stub

What is fixed is the *shape of the answer*:

```
export type ExtractedStudent = {
  roll_no: string | null;
  name: string | null;
  confidence: number;        // 0–1, so the review screen can highlight doubt
};

export type ExtractionResult<T> = {
  rows: T[];
  page_count: number;
  source: string;            // which tool read it
};
```

`roll_no` and `name` are both nullable, because a photo of a printed list genuinely does produce rows where one is unreadable. The review screen flags those. A type that promised `string` would force the eventual implementation to invent a value.

`confidence` exists so the screen can highlight the rows most likely to be wrong — which is the whole point of the review step.

Two rules will survive whichever tool is chosen, and they are written into the file:

- *Nothing extracted is ever written straight to the database.* It goes to the review screen first. A misread roll number silently corrupts that student's attendance and result for the entire semester.
- *The file never travels through Express.* The app uploads to Supabase Storage and sends the path, which is what these functions take.

## The PDF stub

The part that is *not* a stub is everything above the renderer. `buildReport` returns a complete document:

```
export type ReportDocument = {
  type: ReportType;
  title: string;
  header: ReportHeader;                               // course, teacher, date, signature line
  columns: string[];                                  // column headings, in order
  rows: (string | number | null)[][];                 // one array per row
  summary: { label: string; value: string | number }[];
  notes: string[];                                    // footnotes, e.g. missing marks
};
```

All three reports are finished — `result`, `attendance` and `course` — and they can be fetched today as JSON.

So `renderReportPdf` has no arithmetic to do:

```
export async function renderReportPdf(_document: ReportDocument): Promise<Buffer> {
  throw new AppError(503, "PDF rendering is not configured yet. ...");
}
```

When a library is picked, it becomes "draw the header, draw a table from `columns` and `rows`, draw the summary, draw the notes, draw a signature line". It does no calculation, touches no database, and makes no formatting decisions beyond layout — every value it prints is already in the object it is handed.

That is the spec's rule: *"Computation is a pure function, kept separate from PDF rendering. Never calculate inside the PDF code."*

PAGEBREAK

# 12 · Seeding and smoke testing

> Two scripts that are not part of the server but are how you know it works.

## `scripts/seed.ts` — a realistic full semester

```
npm run seed
```

It builds a complete, believable semester: *Database Systems (CS-301), Fall 2026*, 1 September to 18 December, Mondays and Wednesdays, with

- 14 real Database Systems topics needing 30 classes across 30 available slots — deliberately tight, so disruptions bite
- 42 students with Pakistani names and roll numbers `CT-21001` upward
- 8 assessments: four quizzes, two assignments, a midterm and a final
- 19 classes conducted with attendance, 2 cancelled
- 280 marks entered, with Quiz 4 *deliberately* left half-done
- 4 material records
- a replan triggered by the cancellations

### It runs through the real services

```
import { generatePlan, replanCourse, getDeficitOptions } from "../src/services/plan.service.ts";
import { importStudents } from "../src/services/student.service.ts";
import { submitAttendance } from "../src/services/attendance.service.ts";
import { createAssessment, saveMarks, getResults } from "../src/services/grading.service.ts";
```

It does not insert rows directly — it calls the same functions the endpoints call. So running it is an end-to-end test: if the planner, the attendance rules or the grade computation were broken, the script would fail or print wrong numbers.

That is exactly how the topic-status bug was found. The pure functions were all correct and all 55 tests passed, but the seed printed *"syllabus covered 7%"* after 19 conducted classes. Chapter 8 has the fix.

### The data is deterministic

```
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

const random = makeRandom(20260927);
```

A hand-written pseudo-random generator rather than `Math.random()`, so *every run produces the same demo*. The same students are absent on the same days and score the same marks.

This matters for a demo: you can rehearse it, and the numbers on the screen are the numbers you practised with. With `Math.random()` the class average would be different every time.

!NOTE This script is the only place in the repo allowed to contain invented data. CLAUDE.md: *"No mock or placeholder data in application code. Seed data goes in a seed script."* Nothing in `src/` contains a fake student or a fake mark.

### It is safe to run twice

```
const removed = await pool.query(
  `delete from course where teacher_id = $1 and code = $2 returning id`,
  [teacherId, COURSE.code],
);
```

It deletes any previous CS-301 for this teacher first, so repeat runs do not pile up courses. `on delete cascade` removes everything belonging to that course with it.

### `scripts/create-demo-user.ts`

The seed needs a teacher, and a teacher must be a real Supabase user because of the foreign key to `auth.users`. This script creates one through the Supabase Admin API:

```
const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: "POST",
  headers: {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ email, password, email_confirm: true, ... }),
});
```

It is a *script*, not an endpoint, and that is deliberate: we do not build authentication. Creating a user is an administrative job done once from a terminal. The service role key is what makes the call allowed, and it stays on the server.

The demo login it creates:

```
email     demo.teacher@ustaadassist.test
password  UstaadAssist#Demo2026
```

`email_confirm: true` skips the confirmation email, which is right for a test account on a development project.

PAGEBREAK

## `scripts/smoke.sh` — is every route actually wired up

```
npm run smoke 8          # 8 is the seeded course id
```

It signs in, then calls all 33 endpoints once and checks the status code:

```
  ok    200 GET    /health
  ok    200 GET    /auth/me
  ok    401 GET    /auth/me with no token
  ok    404 GET    /nothing-here
  ok    404 GET    /courses/999999
  ok    400 PUT    /courses/8/weightage
  ok    400 POST   /courses/8/materials
  ...
  ok    503 GET    /courses/8/reports/result.pdf
  ok    503 POST   /courses/8/students/extract

  33 passed, 0 failed
```

### It is a different kind of test from `npm test`

| | `npm test` | `npm run smoke` |
|---|---|---|
| Checks | that the answers are *right* | that every route is *reachable* |
| Needs | nothing | the server and the database |
| Speed | 300ms | a few seconds |
| Catches | wrong arithmetic, wrong dates | unmounted routers, renamed routes, a service that throws on empty data |

The unit tests cannot catch a router that was never added to `index.ts` — every function it calls is perfectly correct, it is just unreachable. The smoke test cannot catch a wrong week number. Both are needed.

### The failures it deliberately checks

The interesting half of the script is the expected *failures*:

```
check 404 GET  /courses/999999                              # somebody else's course
check 400 PUT  "/courses/$COURSE/weightage" '{"quiz":10,"final":10}'   # does not total 100
check 400 POST "/courses/$COURSE/materials" '{"title": broken}'        # not valid JSON
check 503 GET  "/courses/$COURSE/reports/result.pdf"                   # stub
```

A test suite that only checks the happy path would pass on an API that accepted a weightage of 20% and let anyone read anyone's course.

### Two bugs it found

Both are in this guide already, and both are the kind unit tests structurally cannot find:

- *`plan/generate` mid-semester* scheduled a second class onto dates that already held conducted classes. Chapter 8 has the guard that now refuses it.
- *A malformed JSON body returned `500 Something went wrong`.* Chapter 5 has the fix: it is now a `400` naming the problem.

---

## The full verification, in order

```
npm run typecheck     # 0 errors
npm test              # 74 passed  (55 planner/grading + 19 contract)
npm run dev           # in one terminal
npm run seed          # in another
npm run smoke 8       # 39 passed
```

Current state: type-check clean, 74 unit tests passing, 39 endpoint checks answering correctly against a real PostgreSQL database and real Supabase tokens.

PAGEBREAK
