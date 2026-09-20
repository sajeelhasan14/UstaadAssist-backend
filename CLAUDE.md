# UstaadAssist

A mobile app that helps a university teacher plan and run an entire semester for a course.

Status: nothing built yet. Start at Milestone 1 in the Build order section.

---

## 1. Objective

The teacher sets up a course once (topics, class days, holidays, assessment dates). From that point the system **generates the teaching timetable itself** and **keeps it correct** as the semester breaks down in real life: cancelled classes, public holidays, topics that take longer than planned.

Around that plan, the app handles the teacher's daily work: attendance, marks and grading, quizzes, course material, reports and a dashboard.

### The one thing that matters

This is a university project with an explicit requirement: **it must not be a traditional CRUD management system.** The planner engine (Section 3) is what makes it different. Everything else is supporting surface.

When you are deciding where to put effort, or when a shortcut would weaken the planner to save time somewhere else: **protect the planner.** It is the graded core.

### Design rule for every screen: minimum input

If the teacher has to type for forty minutes before seeing anything useful, the app is dead on day one.

> Ask for the minimum, generate a draft, let the teacher correct it.

Concretely, and this is binding on every feature you build:

- Topics are entered as one textarea, one topic per line. Never a repeated "add topic" form.
- Only the topic title is required. `sessions_needed` defaults to 1, `min_sessions` to 1, `priority` to normal. The teacher corrects them after seeing the generated plan, not before.
- Students are **never typed**. The teacher photographs the printed class list with the phone camera, or uploads the PDF the department already sent, and the system extracts roll numbers and names from it. Pasting a block of text is the fallback, not the primary path. See Section 3.7.
- Holidays are preloaded and the teacher unchecks what does not apply.
- The minimum needed to generate a plan is: course name, start date, end date, class days, topic titles. Nothing else is requested at setup. Students, weightage and material are asked for later, only when the feature that needs them is opened.
- Attendance defaults every student to present; the teacher taps only the absentees.
- Marks entry uses a numeric keypad and auto-advances to the next student.

If a feature you are building would require the teacher to type a lot, stop and propose a bulk or default-based alternative first.

---

## 2. Tech stack

| Layer | Choice |
|---|---|
| Mobile app | React Native (Expo) |
| Navigation | React Navigation |
| Backend | Node.js + Express.js, REST, JSON |
| Language | **TypeScript.** Run directly by Node 22 via `--experimental-strip-types` — no build step, no `dist/`. `tsc --noEmit` type-checks only; it never emits. |
| Database | PostgreSQL |
| DB access | **Raw SQL via `pg`. No ORM. No Prisma, no Sequelize, no Knex.** |
| Validation & API docs | Zod schema per endpoint → OpenAPI → Swagger UI at `/docs`. One definition yields request validation, TS types (`z.infer`), the docs, and the mock server. |
| Testing | Node's built-in `node:test`. No Jest, no Vitest. |
| Auth | Supabase Auth |
| File storage | Supabase Storage |
| Migrations | Plain numbered `.sql` files in `/migrations` (this backend repo *is* the server), run manually with `psql`. |
| PDF generation | Tool not decided yet, but the feature is required and fully owned by the app. See Section 3.8. Leave a stub service with a clear interface until the tool is picked. |
| Document extraction | Tool not decided yet. One vision-capable service handles both the course outline and the class list photo. Leave a stub with a clear interface. |

### Hard constraints

- **Do not add an ORM or query builder.** Write SQL. This is deliberate.
- **Do not build authentication.** Supabase Auth issues the token. The Express side only *verifies* it: middleware reads the `Authorization: Bearer <token>` header, verifies the signature against the project JWKS endpoint (`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`) using `jose`, and attaches `req.auth`. That is the entire auth implementation. Do not verify with a shared JWT secret — the project uses asymmetric signing keys.
- **Do not upload files through Express.** The app uploads directly to a Supabase Storage bucket and sends the returned path to the API, which saves it in the `material` table.
- No secrets in the repo. `.env` is gitignored, and `.env.example` lists the keys.
- **Dev tooling uses Node 22 built-ins.** `--watch` instead of `nodemon`, `--env-file` instead of `dotenv`. Do not add either package.
- **The approved dependency list is closed.** Runtime: `express`, `pg`, `jose`, `zod`, `@asteasolutions/zod-to-openapi`, `swagger-ui-express`. Dev: `typescript`, `@types/*`. Anything else needs asking first.
- The Supabase service role key lives on the server only. Never in the React Native app.

---

## 3. The planner engine (build this carefully)

This is the part that must be correct and must be explainable in a viva.

Keep the planner **pure**: functions take data in and return data out, and do not run queries themselves. The calling service loads the data, calls the planner, and writes the result. This is what makes it testable, and it is the one part of the codebase that gets tests.

Build the planner first. Sessions are the backbone of the whole app — attendance, topic progress and every report hang off them — so several later modules become trivial once the planner exists.

### 3.1 Slot generation

Input: `start_date`, `end_date`, `class_days` (e.g. `['mon','wed']`), holiday list.

Walk every date from start to end. Keep it if its weekday is in `class_days` and it is not a holiday. The result is the ordered list of real dates on which class can happen.

### 3.2 Topic allocation

Walk topics in `order_no`. Each topic consumes `sessions_needed` slots. Assign sequentially, one pointer into the slot list.

Output is a list of sessions, each with a date, a week number and the topic (plus `part_no` when a topic spans several classes). Topics that run past the end of the slot list go into an `overflow` array — they did not fit.

### 3.3 Assessment date validation

For each assessment, find the latest session date among the topics it covers (`assessment_topic` join).

If `assessment.date` is earlier than that, move the assessment to the next available date after it, and return a human-readable reason string:

> Quiz 3 moved from 18 Sep to 25 Sep because Normalization will not be completed before 24 Sep.

A quiz must never be scheduled before its topics are taught. This rule is not optional.

### 3.4 Replanning

Triggered when the teacher cancels a class or changes a topic's `sessions_needed` mid-semester.

**Principle: freeze the past, rebuild the future.**

- Sessions with `status = 'conducted'` are never touched.
- Slots from today onward are rebuilt.
- Only topics not yet completed are re-allocated.
- Assessment validation (4.3) runs again afterwards.
- The response must report *what changed*, not just the new plan. The app shows this on a "what moved" screen.

### 3.5 Deficit resolution

```
deficit = sessions_still_needed - slots_still_available
```

If `deficit > 0`, do not throw an error. Return three computed options:

1. **Drop** — lowest-priority remaining topics whose combined sessions cover the deficit.
2. **Compress** — topics currently above their `min_sessions`, reduced until the deficit is covered.
3. **Extend** — `deficit` suggested makeup dates on non-class days.

The teacher picks one, the app applies it, and the planner runs again. This screen is the demo highlight — give it real care.

### 3.6 Schedule health

```
behind_by_weeks = (sessions_planned_up_to_today - sessions_conducted) / classes_per_week
```

Feeds the dashboard warning: "You are 1 week behind your plan."

### 3.7 Student list extraction

The teacher opens the camera, photographs the printed class list, and the system returns the students. A PDF upload does the same thing. Typing is not an accepted path, and pasting text is only a fallback.

Flow:

```
capture photo / upload PDF
   -> extraction service returns [{ roll_no, name }, ...]
   -> REVIEW SCREEN: editable table, teacher fixes what is wrong
   -> confirm -> students + enrollments saved
```

**The review screen is mandatory.** Never write extracted students straight to the database. Printed roll numbers misread easily (`CT-21001` vs `CT-2100I`), and a wrong roll number silently corrupts that student's attendance and result for the whole semester. The extraction is a draft; the teacher's confirmation is the source of truth.

Handle in the review step:
- rows with a missing roll number or missing name flagged in the UI
- duplicate roll numbers flagged, not silently merged
- the teacher can delete a row and add a row manually
- multi-page lists: several photos append to one pending list before confirming

### 3.8 Result generation

**The app owns the final result end to end.** The teacher enters marks and nothing else. No exporting to Excel, no manual assembly, no external template.

Given the `weightage` rows and the marks entered for each assessment, the system computes for every student: each component total, the weighted percentage, and the letter grade. The grading scale is configurable per course, seeded with a sensible default the teacher can edit — grading scales differ between universities, so it must never be hardcoded. Then it produces the result PDF.

The result PDF must contain:
- header: course name and code, semester, teacher name, department
- one row per student: roll number, name, per-component totals (quizzes, assignments, midterm, final, participation), weighted total, grade
- class summary: number of students, class average, highest and lowest, grade distribution, pass count
- generation date and a signature line

Rules:
- Computation is a pure function, kept separate from PDF rendering. Never calculate inside the PDF code.
- Round once, at the end. Do not round per component.
- A student with a missing mark is reported as missing, never silently treated as zero.
- The same computation feeds the results screen and the PDF, so the screen and the document can never disagree.

The two other reports (attendance report, course report) use the same pipeline.

### Testing

The planner is the one part of this codebase that gets tests. Cover at minimum:
- holidays removed from slots correctly
- a multi-session topic spanning consecutive classes
- a quiz auto-moving when its topics slip
- replanning leaving conducted sessions untouched
- deficit producing three valid options

---

## 4. API contract

The mobile track builds against this, so **do not rename endpoints without saying so.**

```
GET    /auth/me                          signed-in teacher profile (sign-in itself is Supabase, in the app)

POST   /courses                          create course
GET    /courses                          list teacher's courses
POST   /courses/:id/clone                clone a previous semester's course
POST   /courses/:id/topics               accepts a pasted block of lines
POST   /courses/:id/outline/import       upload outline file -> extracted topics for review
POST   /courses/:id/students/extract     photo or PDF of the class list -> parsed rows for review (nothing saved)
POST   /courses/:id/students/import      save the reviewed, confirmed student list
POST   /courses/:id/holidays             confirm / toggle preloaded holidays

POST   /courses/:id/plan/generate        run the planner, create sessions
POST   /courses/:id/plan/replan          rebuild the future after a disruption
GET    /courses/:id/plan/deficit         the three resolution options
POST   /courses/:id/plan/deficit/apply   apply the chosen option

GET    /courses/:id/sessions             week-by-week plan
PATCH  /sessions/:id                     mark conducted / cancelled
POST   /sessions/:id/attendance          submit attendance
GET    /courses/:id/attendance/summary   percentages + below-threshold list

POST   /courses/:id/assessments          create quiz / assignment / midterm / final
POST   /assessments/:id/marks            enter marks
GET    /courses/:id/results              weighted totals and grades (same computation as the PDF)
GET    /courses/:id/grade-scale          the course grade scale
PUT    /courses/:id/grade-scale          edit the grade scale
GET    /courses/:id/analysis/topics      topic-wise class performance

POST   /courses/:id/materials            save material record after Supabase upload
GET    /courses/:id/dashboard            every dashboard number in one response
GET    /courses/:id/reports/:type.pdf    generate and return a report

GET    /docs                             Swagger UI — generated, never hand-written
GET    /openapi.json                     the OpenAPI spec, generated from the Zod schemas
```

Every field name in requests and responses uses `snake_case`, matching the database columns, so no mapping layer exists between SQL and JSON. *(Pending final confirmation.)*

Response shape, used everywhere:

```json
{ "success": true, "data": { }, "message": null }
{ "success": false, "data": null, "message": "Course not found" }
```

Errors go through one error-handling middleware. Controllers never send error responses directly.

---

## 5. Modules

| # | Module | Notes |
|---|---|---|
| M1 | Semester planner | Section 3. The core. Build first. |
| M2 | Teaching plan & progress | Week view, mark conducted/cancelled, behind-schedule warning |
| M3 | Attendance | Present-by-default marking, percentages, threshold flagging |
| M4 | Marks & grading | Teacher-defined weightage and grade scale, weighted total, letter grade, **full result PDF generated by the app** |
| M5 | Quiz management | Quizzes tied to topics; every question tagged with a topic |
| M6 | Course material | Folders per course, uploaded to Supabase Storage |
| M7 | Dashboard & reports | All numbers in one endpoint; three PDF reports (result, attendance, course) |

**Topic-wise analysis** is a small feature worth protecting: because every question carries a `topic_id`, the system can report how the *class* performed per topic, not just per student. A topic averaging 41% gets flagged and the planner can schedule a revision session. This closes the loop — plan, teach, assess, detect the gap, re-plan — and is a large part of why this is not a management system.

---

## 6. Build order

1. **Milestone 1** — Repo, migrations, `pg` pool, Supabase JWT middleware, `GET /auth/me`, health check endpoint.
2. **Milestone 2** — Course creation, bulk topic input, holiday preloading. `POST /plan/generate` producing a correct timetable, with tests.
3. **Milestone 3** — Replanning, deficit options, schedule health. Tests for each.
4. **Milestone 4** — React Native shell: Supabase sign-in, course setup wizard, teaching plan screen, replan result screen.
5. **Milestone 5** — Class list extraction with the review screen, then attendance and marks, backend and screens.
6. **Milestone 6** — Quizzes with topic-tagged questions, topic-wise analysis.
7. **Milestone 7** — Result computation and the result PDF, then attendance and course reports, materials, dashboard endpoint.
8. **Milestone 8** — Seed a realistic full-semester demo course. Polish.

Do not start a milestone before the previous one runs end to end.

---

## 7. Working rules for Claude Code

- **Ask before adding a dependency.** The stack above is fixed.
- Keep changes scoped to what was asked. Do not refactor unrelated files, do not "improve" working code.
- The data model is not defined in this file yet. Propose it and agree it with me before writing migrations, and do not invent endpoints beyond the contract above without asking.
- Prefer boring, readable code over clever code. This will be defended in a viva by people who did not write it.
- No mock or placeholder data in application code. Seed data goes in a seed script.
- When a task is ambiguous, ask one specific question rather than guessing and building the wrong thing.
- After changing planner logic, run the planner tests before moving on.

---

## 8. Team context

Four people. One backend (the lead), three on the React Native app, working in parallel.

This changes the weight of one existing rule: **endpoint names and field names are frozen once published.** Three developers build against them. A rename that costs the backend two minutes costs the team an afternoon.

How the two tracks stay in sync:

- The **Swagger UI at `/docs`** is the contract. It is generated from the Zod schemas, so it cannot drift from the code. There is no separate document to keep updated.
- The mobile track builds against a **mock server** generated from the same OpenAPI spec, then switches one base URL when the real endpoint lands.
- If the app needs a field that does not exist, it is requested and added. It is never invented on the client.
- **Weekly integration checkpoint:** the app runs against the real backend, not the mock.

What the mobile track can build with no backend at all: the design system, navigation, Supabase sign-in and session persistence, and every screen layout. Supabase Auth runs in the app and does not touch Express.
