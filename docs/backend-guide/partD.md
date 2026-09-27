# 14 · Quick reference

> The things worth having at hand — for a viva, or for picking the project back up in three months.

## The five questions most likely to be asked

#### "Why is this not just a CRUD app?"

Because the central feature is a *computation*, not storage. The planner takes dates, class days, holidays and topics and derives a timetable that nobody typed. Then it maintains it: cancel a class and it rebuilds the future while leaving conducted classes untouched, and when the semester runs short it computes three different resolutions and explains the trade-offs. None of that is Create, Read, Update or Delete.

#### "Why no ORM?"

Two reasons. A defensible one: an ORM would have generated the SQL, and the interesting queries here are ones it would generate badly — inserting 42 attendance rows in one statement with `unnest`, several counts in one pass with `count(*) filter`, an upsert with `on conflict`. And an honest one: writing the SQL means understanding it, and "the library did it" is not an answer.

#### "Why is the planner pure?"

So it can be tested, so it cannot surprise you, and so it can be explained. 55 tests run in 300 milliseconds with no database. `today` is an argument rather than read from the clock, which is what lets a test ask "pretend it is 18 November" and what lets the demo show a whole semester in September.

#### "How is authentication handled?"

It is not built. Supabase Auth issues an ES256-signed JWT inside the app. The backend verifies the signature against Supabase's *public* key, fetched once from the JWKS endpoint and cached. It never contacts Supabase to check a token and never holds a key that could create one. Then every query filters on the user id from that verified token.

#### "What stops me reading another teacher's course?"

Every query that takes an id from the URL also filters on `teacher_id` from the token — never from the request body. `src/services/ownership.ts` centralises it. A course that exists but is not yours returns `404`, not `403`, because `403` would confirm the id is real.

---

## The five rules that must not be broken

| Rule | Why | Breaking it looks like |
|---|---|---|
| The planner never queries the database | Testability, purity | A `pool.query` inside `src/planner/` |
| `mark.obtained` stays nullable with no default | A missing mark is not a zero | `not null default 0` "to simplify the code" |
| Conducted sessions are never rewritten | Freeze the past | Deleting sessions without `and status = 'planned'` |
| The owner comes from the token, never the body | Anyone can put anything in a body | `teacher_id: req.body.teacher_id` |
| Round once, at the end | Early rounding moves grade boundaries | `round2()` called inside the component loop |

---

## The numbers

| | |
|---|---|
| Tables | 16 across 2 migrations |
| Endpoints | 40, all documented at `/docs` |
| Runtime dependencies | 9 |
| Pure planner files | 6, with no database access |
| Tests | 74, running in about 400ms |
| Lines of SQL written by a library | 0 |

## Where to look for what

| If you need to... | Go to |
|---|---|
| Change how the timetable is built | `src/planner/allocate.ts` |
| Change which dates are usable | `src/planner/slots.ts` |
| Change how a quiz gets moved | `src/planner/assessments.ts` |
| Change what happens when time runs out | `src/planner/deficit.ts` |
| Change how grades are computed | `src/grading/compute.ts` |
| Add an endpoint | the matching file in `src/routes/`, then a service |
| Change the error format | `src/middleware/error.ts`, and nowhere else |
| Change the response envelope | `src/http.ts`, and nowhere else |
| Add or change an endpoint's docs | `src/openapi/contract.ts` — the docs and validation both follow |
| Add a table | a new numbered file in `migrations/` |
| Change the demo | `scripts/seed.ts` |
| Deploy it | `DEPLOYMENT.md`, and chapter 13 for why |

---

## Two things left open

*There is no `DELETE /courses/:id`.* A teacher cannot delete a course. It was left out rather than invented, because the endpoint list is frozen and three developers build against it. It is a one-line addition once agreed.

*The two stubs need their tools chosen.* Document extraction and PDF rendering. Everything except the tool is finished in both cases, and the interfaces are fixed, so neither will ripple outward.

## Finally: the order things were built in

Worth knowing, because it explains why the code looks the way it does.

The planner was built *first*, before any route that uses it — because `session` is the table everything else hangs off. Attendance is per session. Topic progress is derived from sessions. Every report counts sessions. Once the planner existed and was tested, attendance, marks, the dashboard and the reports were each a short service on top of data that was already correct.

Building it the other way round — CRUD first, planner last — would have meant retrofitting the interesting part into a schema shaped by the boring parts.
