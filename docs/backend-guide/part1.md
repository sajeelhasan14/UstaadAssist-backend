# 1 · What this backend is, in one page

> Read this chapter and you will know what the server does and why it exists. Everything after it is detail.

## The problem the app solves

A university teacher sets up a course once: the name, the start and end dates, the days they teach, and a list of topics. From that point the system *works out the teaching timetable itself* and *keeps it correct* as the semester falls apart in real life — classes get cancelled, public holidays land on a Monday, a topic that was supposed to take one class takes three.

Around that plan sit the everyday jobs: attendance, marks, grading, course material, reports and a dashboard.

## What makes it not a CRUD app

A CRUD app is Create, Read, Update, Delete. A form saves a row, a list shows the rows. Most university projects are exactly that, and the requirement for this project was explicitly that it must *not* be.

The thing that makes UstaadAssist different is the *planner*. The planner is not storage — it is a calculation. You give it dates, class days, holidays and topics, and it computes a timetable. You tell it a class was cancelled and it recomputes the future while leaving the past alone. When there is not enough time left in the semester, it does not show an error: it computes three different ways out and lets the teacher choose.

!NOTE That calculation is the graded core of the project. Chapter 6 covers it function by function, and it is the part you should be able to explain on a whiteboard without looking at the code.

## What the backend is responsible for

The backend is a *REST API*. It has no screens. It speaks JSON over HTTP and the mobile app draws everything.

Its job is exactly four things:

- *Keep the data.* One PostgreSQL database with 16 tables.
- *Run the planner.* Take the course setup, compute the timetable, save it, and recompute it when things change.
- *Compute the results.* Take the marks and the weightage, compute every student's weighted total and letter grade, and produce the report data.
- *Check who is asking.* Every request must carry a valid token, and a teacher can only ever see their own courses.

And two things it is explicitly *not* responsible for:

- *It does not do sign-in.* Supabase Auth handles that inside the mobile app. The backend only *verifies* the token Supabase issued. Chapter 5 explains exactly how.
- *Files never pass through it.* The app uploads a photo or a PDF straight to Supabase Storage and sends the backend only the resulting path.

## The whole request flow, end to end

Here is what happens when the teacher taps something in the app. This single picture explains the shape of every file in the project.

```
  PHONE                          YOUR SERVER (Express)                    POSTGRES
  -----                          ---------------------                    --------

  teacher taps
  "Generate plan"
       |
       |  POST /courses/3/plan/generate
       |  Authorization: Bearer eyJhbGci...
       +------------------------------->
                                   |
                            express.json()
                            turns the body into req.body
                                   |
                            requireAuth
                            - reads the token
                            - checks the signature against Supabase
                            - sets req.auth = { userId, email }
                                   |
                            the ROUTE (src/routes/plan.ts)
                            reads courseId from the URL
                                   |
                            the SERVICE (plan.service.ts)
                                   |
                              1. LOAD ----------------------> select course
                                                              select topics
                                   <---------------------      select holidays
                                   |
                              2. THINK
                                 the PLANNER (src/planner/*)
                                 pure maths. no database.
                                 slots -> topics -> sessions
                                   |
                              3. SAVE ----------------------> delete old sessions
                                                              insert new sessions
                                   |
                            ok(res, result, 201)
       <-------------------------------+
       |
  { "success": true, "data": { ... }, "message": null }
       |
  app draws the week-by-week plan
```

Every feature in this backend follows that same shape: *route → service → (planner or SQL) → response*. Once you have seen it once, the other thirty endpoints are variations.

---

## The five layers, and why they are separate

| Layer | Folder | Its one job | Does it touch the database? |
|---|---|---|---|
| `routes/` | `src/routes/` | Read the request, call a service, send the answer | No |
| `services/` | `src/services/` | Load data, call the planner, save the result | *Yes* — this is the only place that does |
| `planner/` | `src/planner/` | Compute the timetable. Pure calculation | *No, never* |
| `grading/` | `src/grading/` | Compute results and grades. Pure calculation | *No, never* |
| `middleware/` | `src/middleware/` | Run before or after every route: auth, errors | No |

The important line in that table is the one that appears twice: *the planner and the grading engine never touch the database.* They take data as arguments and return data. Nothing else.

That is not a style preference. It buys three concrete things:

- *They can be tested.* A test can call `generateSlots("2026-09-01", "2026-12-18", ["mon","wed"], [])` and check the answer, with no database running, in under a millisecond. There are 54 such tests.
- *They cannot surprise you.* The same inputs always produce the same output. There is no hidden state, no clock, no network.
- *They can be explained.* In a viva you can walk through `allocateTopics` on paper, because it is a loop over an array, not a query.

!WARN This is the rule most likely to be broken accidentally. If you ever find yourself wanting to add a `pool.query` inside `src/planner/`, that is the signal that the data should have been loaded by the service and passed in as an argument instead.

PAGEBREAK

## The technology, and why each piece

| Piece | Version | Why it is here |
|---|---|---|
| Node.js | 22 | The JavaScript runtime. Version 22 matters — it can run TypeScript directly and it has a built-in test runner and `.env` loader |
| Express | 5 | The web framework. Handles routing and middleware |
| TypeScript | 7 | JavaScript with types. Catches mistakes before the code runs |
| PostgreSQL | 17.6 | The database, hosted on Supabase |
| `pg` | 8.23 | The PostgreSQL driver. Sends SQL, returns rows |
| `jose` | 6.2 | Verifies the signature on Supabase's tokens |

That is the entire runtime dependency list. Six packages.

### Three deliberate absences

*No ORM.* No Prisma, no Sequelize, no Knex. Every query in this project is SQL you can read. An ORM would have written the queries for you and hidden what the database is actually doing — and in a viva, "the library generated it" is not an answer. Writing the SQL also meant using the parts of PostgreSQL that actually fit the problem, like `unnest` to insert forty rows in one statement.

*No build step.* There is no `dist/` folder and nothing is compiled. Node 22 runs `.ts` files directly with the `--experimental-strip-types` flag, which throws the type annotations away at load time and runs the JavaScript underneath. `tsc --noEmit` is run separately, purely to check the types — it never produces output files.

*No `nodemon`, no `dotenv`.* Node 22 has `--watch` (restart when a file changes) and `--env-file` (load `.env`) built in. Two fewer packages to explain.

### Running it

| Command | What it does |
|---|---|
| `npm run dev` | Start the server and restart on every save |
| `npm start` | Start the server once |
| `npm test` | Run all 55 planner and grading tests |
| `npm run typecheck` | Check the types without running anything |
| `npm run seed` | Build a full realistic demo semester in the database |
| `npm run smoke` | Call all 33 endpoints once and print the status codes |

The first time on a new machine, in order:

```
npm install

# create the tables
psql "$DATABASE_URL" -f migrations/001_init.sql
psql "$DATABASE_URL" -f migrations/002_makeup_date.sql

# create a login to test with
npm run create-demo-user

# fill the database with a realistic semester
npm run seed

npm run dev
```

### The four secrets in `.env`

```
PORT=4000
DATABASE_URL=postgresql://...        <- full read/write on the database
SUPABASE_URL=https://xxx.supabase.co <- public, safe to ship in the app
SUPABASE_SERVICE_ROLE_KEY=eyJ...     <- full admin on the Supabase project
```

`.env` is in `.gitignore`. `.env.example` lists the key *names* with no values, so somebody cloning the repo knows what to fill in.

!WARN `DATABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are both total-compromise secrets. Anyone holding either one can read or delete everything. Neither belongs anywhere near the React Native app. `SUPABASE_URL` and the *anon* key are the only two values that are safe in the app, and the anon key is not even needed by this backend.

PAGEBREAK

## The complete file map

Every file in the project, with one line on what it does. The chapters after this go through them properly.

### The plumbing

| File | What it does | Chapter |
|---|---|---|
| `src/index.ts` | Starts the server, mounts every router in order | 5 |
| `src/http.ts` | `ok()`, `AppError`, `pathId()` — the response shape | 5 |
| `src/db/pool.ts` | The database connection pool and `transaction()` | 5 |
| `src/middleware/requireAuth.ts` | Verifies the Supabase token | 4 |
| `src/middleware/error.ts` | The only place that sends an error response | 5 |

### The pure calculation — the graded core

| File | What it does | Chapter |
|---|---|---|
| `src/planner/slots.ts` | Works out the real dates class can happen on | 6 |
| `src/planner/allocate.ts` | Spreads topics across those dates | 6 |
| `src/planner/assessments.ts` | Moves a quiz that falls before its topics | 6 |
| `src/planner/replan.ts` | Freezes the past, rebuilds the future | 6 |
| `src/planner/deficit.ts` | Computes the three ways out of a shortage | 6 |
| `src/planner/health.ts` | How many weeks behind the teacher is | 6 |
| `src/grading/compute.ts` | Weighted totals and letter grades | 7 |

### The services — the only code that touches the database

| File | What it does | Chapter |
|---|---|---|
| `src/services/ownership.ts` | "Does this teacher own this row?" | 8 |
| `src/services/plan.service.ts` | Load / think / save for the planner | 8 |
| `src/services/session.service.ts` | Mark a class conducted or cancelled | 8 |
| `src/services/attendance.service.ts` | Present-by-default attendance, percentages | 8 |
| `src/services/student.service.ts` | Save a reviewed class list, student records | 8 |
| `src/services/grading.service.ts` | Assessments, marks, weightage, results | 8 |
| `src/services/course.service.ts` | Course settings, cloning, topic edits | 8 |
| `src/services/material.service.ts` | Course material records | 8 |
| `src/services/dashboard.service.ts` | Every dashboard number in one response | 8 |
| `src/services/report.service.ts` | Assembles the three reports | 8 |
| `src/services/extraction.service.ts` | Reads a class-list photo — *stub* | 10 |

### The routes

| File | Mounted at | Chapter |
|---|---|---|
| `src/routes/auth.ts` | `/auth` | 9 |
| `src/routes/courses.ts` | `/courses` | 9 |
| `src/routes/plan.ts` | `/courses` | 9 |
| `src/routes/sessions.ts` | `/sessions` | 9 |
| `src/routes/topics.ts` | `/topics` | 9 |
| `src/routes/assessments.ts` | `/assessments` | 9 |
| `src/routes/students.ts` | `/students` | 9 |
| `src/routes/materials.ts` | `/materials` | 9 |

### Everything else

| File | What it does |
|---|---|
| `src/data/pakHolidays.ts` | The Pakistani public holidays that get preloaded |
| `migrations/001_init.sql` | Creates 15 tables |
| `migrations/002_makeup_date.sql` | Creates the 16th, for agreed makeup classes |
| `tests/planner.test.ts` | 20 tests for slots, allocation and quiz dates |
| `tests/replan.test.ts` | 20 tests for replanning, deficit and health |
| `tests/grading.test.ts` | 15 tests for result computation |
| `scripts/seed.ts` | Builds a realistic full-semester demo course |
| `scripts/create-demo-user.ts` | Creates a login through the Supabase Admin API |
| `scripts/smoke.sh` | Calls every endpoint once and checks the status code |
