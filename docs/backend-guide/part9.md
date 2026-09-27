# 9 · Every endpoint

> The complete API. What each one takes, what it gives back, and which service does the work. This is the contract three mobile developers build against, so the names are frozen.

This chapter is the reference in prose. The *live* version is the Swagger UI at `/docs`, which is generated from the code and therefore cannot be out of date — chapter 10 explains how that works.

## The rules that apply to all of them

- *Every response* has the shape `{ success, data, message }`. No exceptions.
- *Every field name* is `snake_case`, matching the database columns — so there is no mapping layer between SQL and JSON.
- *Every route except* `/health` requires `Authorization: Bearer <token>`.
- *Every `:id`* is scoped to the signed-in teacher. Somebody else's id returns `404`.
- *Routes never send errors.* They throw; `errorHandler` answers.

### Status codes used

| Code | Meaning here |
|---|---|
| `200` | Fine |
| `201` | Something was created |
| `400` | The request was wrong — bad value, missing field, invalid JSON |
| `401` | No token, or a token that does not verify |
| `404` | Does not exist, *or* is not yours |
| `409` | Would duplicate an existing row |
| `503` | A feature whose tool is not chosen yet (PDF, extraction) |

---

## Health and identity

| Endpoint | What it does |
|---|---|
| `GET /health` | `{ "status": "ok" }`. No database, no token |
| `GET /auth/me` | The signed-in teacher. Creates their `teacher` row on first call |

Sign-in itself is not here. It happens in the app, against Supabase.

---

## Courses

| Endpoint | Takes | Returns |
|---|---|---|
| `POST /courses` | `name`, `start_date`, `end_date`, `class_days`, optional `code`, `semester` | The new course. Also preloads public holidays |
| `GET /courses` | — | The teacher's courses with counts and a `has_plan` flag |
| `GET /courses/:id` | — | One course with its topics and holidays |
| `PATCH /courses/:id` | Any of `name`, `code`, `semester`, `start_date`, `end_date`, `class_days`, `attendance_threshold` | The updated course, plus `replan_required` |
| `POST /courses/:id/clone` | Optional `name`, `semester`, `start_date`, `end_date` | A new course with the topics and grading setup copied |

### `POST /courses` — the minimum to get started

```
{
  "name": "Database Systems",
  "code": "CS-301",
  "semester": "Fall 2026",
  "start_date": "2026-09-01",
  "end_date": "2026-12-18",
  "class_days": ["mon", "wed"]
}
```

Five fields, two of them optional. No students, no weightage, no grade scale — those are asked for later by the features that need them.

Creating the course and preloading its holidays happens in one transaction, so a course can never exist without its holidays.

---

## Topics

| Endpoint | Takes | Returns |
|---|---|---|
| `POST /courses/:id/topics` | `raw` — one topic per line, as a single string | Every topic, numbered in order |
| `PATCH /topics/:id` | Any of `title`, `sessions_needed`, `min_sessions`, `priority`, `order_no`, `status` | The updated topic, plus `replan_required` |

### `POST /courses/:id/topics` — one textarea, not a form

```
{
  "raw": "Introduction to Database Systems\nThe Relational Model\nEntity Relationship Modelling\nSQL: Queries and Joins"
}
```

*The app sends the whole block of text, not an array.* The server splits it:

```
const titles = raw
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.length > 0);
```

Splitting on the server rather than in the app means all three mobile developers cannot each invent their own splitting rules. Blank lines and stray spaces are handled in one place.

Only the title is required. `sessions_needed` defaults to 1, `min_sessions` to 1, `priority` to `normal` — the teacher corrects them *after* seeing the generated plan, which is when they can actually tell.

!WARN This endpoint *replaces* all topics for the course — it deletes then inserts, in a transaction. That is right for the setup screen, where the teacher is editing one textarea. It is not an "add these topics" endpoint.

---

## Holidays

| Endpoint | Takes | Returns |
|---|---|---|
| `GET /courses/:id/holidays` | — | Preloaded holidays with their `is_active` flag |
| `POST /courses/:id/holidays` | `holidays: [{ id, is_active }]` | The updated rows |

The teacher unchecks what does not apply rather than typing dates. `src/data/pakHolidays.ts` holds the fixed-date holidays as month and day — not full dates — so one list covers every year:

```
{ month: 9, day: 6, name: "Defence Day" }
```

A year loop builds the actual dates for whatever range the course covers. Lunar holidays like Eid cannot be computed this way and are listed per year.

---

## The planner

| Endpoint | Takes | Returns |
|---|---|---|
| `POST /courses/:id/plan/generate` | Optional `reset` | The whole timetable, overflow, moved assessments, deficit |
| `POST /courses/:id/plan/replan` | Optional `today`, `reason` | What was frozen, the rebuilt future, and *what changed* |
| `GET /courses/:id/plan/deficit` | Optional `?today=` | The three resolution options |
| `POST /courses/:id/plan/deficit/apply` | `option`: `"drop"`, `"compress"` or `"extend"` | Applies it, then replans |
| `GET /courses/:id/sessions` | — | Every class, flat and grouped by week |

### `POST /plan/generate`

```
{
  "success": true,
  "data": {
    "sessions": [
      { "date": "2026-09-02", "week_no": 1, "topic_id": 1, "part_no": null, "total_parts": null },
      { "date": "2026-09-07", "week_no": 2, "topic_id": 2, "part_no": 1, "total_parts": 2 },
      { "date": "2026-09-09", "week_no": 2, "topic_id": 2, "part_no": 2, "total_parts": 2 }
    ],
    "overflow": [],
    "assessments_moved": [
      {
        "assessment_id": 3,
        "from": "2026-10-19",
        "to": "2026-11-11",
        "reason": "Quiz 3 moved from 19 Oct to 11 Nov because Normalization will not be completed before 4 Nov."
      }
    ],
    "slots_total": 30,
    "slots_unused": 0,
    "deficit": 0
  },
  "message": null
}
```

Returns `400` if any class has already been conducted, naming `/plan/replan` as the endpoint to use instead.

### `POST /plan/replan`

```
{
  "frozen": 19,
  "sessions": [ ... the rebuilt future ... ],
  "changes": [
    { "kind": "moved", "topic_id": 9, "topic": "File Organisation and Indexing",
      "from": "2026-11-18", "to": "2026-11-23" },
    { "kind": "removed", "topic_id": 14, "topic": "NoSQL and Distributed Databases",
      "from": "2026-12-16" }
  ],
  "assessments_moved": [ ... ],
  "overflow": [ ... ],
  "slots_available": 9,
  "deficit": 2
}
```

`changes` is what the "what moved" screen shows. `frozen` is a count of conducted classes that were not touched.

`today` can be passed in the body to replan as if it were another date — used by the seed script and useful for the demo.

PAGEBREAK

### `GET /plan/deficit`

```
{
  "deficit": 2,
  "drop": {
    "type": "drop",
    "sessions_recovered": 2,
    "covers_deficit": true,
    "topics": [
      { "topic_id": 14, "title": "NoSQL and Distributed Databases", "sessions_freed": 1 },
      { "topic_id": 13, "title": "Recovery and Backup", "sessions_freed": 1 }
    ]
  },
  "compress": {
    "type": "compress",
    "sessions_recovered": 2,
    "covers_deficit": true,
    "topics": [
      { "topic_id": 10, "title": "Query Processing and Optimisation", "from": 2, "to": 1 },
      { "topic_id": 12, "title": "Concurrency Control", "from": 2, "to": 1 }
    ]
  },
  "extend": {
    "type": "extend",
    "sessions_recovered": 2,
    "covers_deficit": true,
    "dates": ["2026-11-19", "2026-11-20"]
  },
  "slots_available": 9,
  "sessions_needed": 11
}
```

`covers_deficit` on each option is the honesty flag — an option may not fully solve the problem, and it says so rather than pretending.

### `GET /courses/:id/sessions`

Returns the plan twice, in two shapes:

```
{
  "sessions": [ ...flat, in date order... ],
  "weeks": [
    { "week_no": 1, "sessions": [ ... ] },
    { "week_no": 2, "sessions": [ ... ] }
  ]
}
```

The grouping is done on the server so every screen that draws a week view does not repeat the same loop. Each session includes `topic_title` from a `left join`, so the app does not need a second request to name the topics.

---

## Sessions and attendance

| Endpoint | Takes | Returns |
|---|---|---|
| `PATCH /sessions/:id` | `status`, and `cancel_reason` when cancelling | The updated session |
| `POST /sessions/:id/attendance` | `absent: [ids]`, optional `leave: [ids]` | Counts of present, absent and leave |
| `GET /sessions/:id/attendance` | — | Every student with their status, defaulting to present |
| `GET /courses/:id/attendance/summary` | — | Per-student percentages and the below-threshold list |

### `POST /sessions/:id/attendance` — only the absentees

```
{ "absent": [12, 40, 41], "leave": [7] }
```

Everyone else enrolled is marked present. For a class of 42 the app sends three or four ids instead of 42.

Submitting attendance also marks the class `conducted`, because that is what actually happened — the teacher held the class and took the roll. And marking it conducted recalculates the topic's status.

`cancel_reason` is *required* when cancelling:

```
if (status === "cancelled" && (typeof cancel_reason !== "string" || cancel_reason.trim() === "")) {
  throw badRequest("cancel_reason is required when cancelling a class");
}
```

Because the course report lists why each class was cancelled, and a blank reason would make that report useless months later.

---

## Students

| Endpoint | Takes | Returns |
|---|---|---|
| `POST /courses/:id/students/extract` | `storage_path` | Parsed rows for review. *Saves nothing.* `503` until the tool is chosen |
| `POST /courses/:id/students/import` | `students: [{ roll_no, name }]` | The saved students and how many were newly enrolled |
| `GET /courses/:id/students` | — | The class list with attendance percentages and a `below_threshold` flag |
| `DELETE /courses/:id/students/:studentId` | — | Removes the enrollment, keeps the student |
| `GET /students/:id` | — | One student: full attendance record and every mark |

### The two-step import, and why it cannot be one step

```
POST /students/extract    -> { rows: [...], saved: false, next_step: "..." }
        |
   REVIEW SCREEN — the teacher fixes what is wrong
        |
POST /students/import     -> saves
```

`extract` deliberately returns `"saved": false` and a `next_step` string. It never writes to the database.

The reason from the spec: printed roll numbers misread easily — `CT-21001` versus `CT-2100I` — and a wrong roll number silently corrupts that student's attendance and result *for the whole semester*, with nothing to reveal the mistake until the final results are wrong. The extraction is a draft; the teacher's confirmation is the source of truth.

The review screen is not optional, and the server enforces its rules again on import.

---

## Assessments, marks and grading

| Endpoint | Takes | Returns |
|---|---|---|
| `POST /courses/:id/assessments` | `type`, `title`, `total_marks`, optional `date`, `topic_ids` | The new assessment |
| `GET /courses/:id/assessments` | — | All of them with `marks_entered` versus `student_count` |
| `POST /assessments/:id/marks` | `marks: [{ student_id, obtained }]` or `{ student_id, is_absent }` | How many were saved and how many ignored |
| `GET /assessments/:id/marks` | — | *Every* student in roll order, with whatever marks exist |
| `GET /courses/:id/results` | — | Weighted totals, grades and the class summary |
| `GET /courses/:id/weightage` | — | The component percentages, seeded on first call |
| `PUT /courses/:id/weightage` | The five components | The updated weightage. Must total 100 |
| `GET /courses/:id/grade-scale` | — | The scale, seeded on first call |
| `PUT /courses/:id/grade-scale` | `bands: [{ grade, min_percentage }]` | The updated scale |

### `type` is one of five

`quiz`, `assignment`, `midterm`, `final`, `participation` — the same five as the weightage components, so every assessment maps to exactly one weighted component.

A quiz is simply an assessment of type `quiz`, marked as a single total. There is no per-question marking: for a class of 70 with 10 questions that would be 700 numbers to type, which fails the minimum-input rule outright.

### `topic_ids` is what makes the planner work

```
{ "type": "quiz", "title": "Quiz 3", "date": "2026-10-19", "total_marks": 10, "topic_ids": [7, 8] }
```

Those topic ids are what lets the planner check the quiz is not scheduled before Functional Dependencies and Normalization are taught. Without them the assessment is simply left where it is.

### `GET /assessments/:id/marks` returns everyone

```
{
  "assessment": { "id": 3, "type": "quiz", "title": "Quiz 3", "date": "2026-11-11", "total_marks": 10 },
  "marks": [
    { "student_id": 1, "roll_no": "CT-21001", "name": "Ahmed Khan", "obtained": 7.5, "is_absent": false },
    { "student_id": 2, "roll_no": "CT-21002", "name": "Ali Malik", "obtained": null, "is_absent": false }
  ]
}
```

Every enrolled student appears, including those with no mark yet — otherwise the teacher could not enter one. `obtained: null` means not entered, and it stays `null` all the way to the screen.

PAGEBREAK

---

## Material, dashboard and reports

| Endpoint | Takes | Returns |
|---|---|---|
| `POST /courses/:id/materials` | `title`, `storage_path`, optional `topic_id`, `mime_type`, `size_bytes` | The saved record |
| `GET /courses/:id/materials` | — | The records, flat and grouped into folders by topic |
| `DELETE /materials/:id` | — | The removed record and its `storage_path` |
| `GET /courses/:id/dashboard` | Optional `?today=` | Every dashboard number |
| `GET /courses/:id/reports/:type` | Optional `?today=` | The finished report as JSON |
| `GET /courses/:id/reports/:type.pdf` | Optional `?today=` | The PDF. `503` until the tool is chosen |

### Files never pass through Express

```
app  ---- the file ---->  Supabase Storage
app  <--- storage path --  Supabase Storage
app  ---- the path ---->  POST /courses/3/materials
```

The backend only ever stores the path. `DELETE /materials/:id` returns the `storage_path` so the app knows which stored file to delete next — the backend does not delete it either.

### `GET /courses/:id/dashboard`

One request, everything:

```
{
  "course": { ... },
  "today": "2026-11-18",
  "schedule": {
    "planned_up_to_today": 20, "conducted": 19, "cancelled": 2,
    "behind_by_weeks": 0.5, "syllabus_percent": 57, "total_sessions": 30,
    "warning": "You are 0.5 weeks behind your plan."
  },
  "topics": { "total": 14, "completed": 8, "in_progress": 1, "pending": 5, "dropped": 0 },
  "next_session": { "id": 244, "date": "2026-11-18", "week_no": 12, "topic_title": "Entity Relationship Modelling" },
  "attendance": {
    "classes_held": 19, "class_average": 88.18, "student_count": 42,
    "below_threshold_count": 0, "below_threshold": []
  },
  "assessments": {
    "upcoming": [ ... next five ... ],
    "marks_outstanding": [ { "id": 31, "type": "quiz", "title": "Quiz 4", "expected": 42, "entered": 28 },
                           { "id": 32, "type": "final", "title": "Final Examination", "expected": 42, "entered": 0 } ]
  },
  "results": { "class_average": 33.25, "highest": 42.19, "lowest": 16.5,
               "grade_distribution": { "F": 42 }, "pass_count": 0, "fail_count": 42,
               "students_with_missing_marks": 42 },
  "last_replan": { "triggered_at": "2026-09-27T00:31:26.137Z", "reason": "2 classes were cancelled during the semester" }
}
```

`marks_outstanding` is the useful one for a teacher — it lists exactly which assessments still need marks and how many are missing.

### The `.pdf` suffix

```
router.get("/:courseId/reports/:type", requireAuth, async (req, res) => {
  const requested = pathId(req.params, "type");
  const wantsPdf = requested.endsWith(".pdf");
  const type = wantsPdf ? requested.slice(0, -".pdf".length) : requested;

  const document = await buildReport(..., type, today(req.query.today));

  if (!wantsPdf) { ok(res, document); return; }

  const pdf = await renderReportPdf(document);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${type}-..."`);
  res.send(pdf);
});
```

One route serves both. `:type` arrives as either `result` or `result.pdf`, and the suffix is stripped to decide which.

The JSON form works *today* and returns the complete report — so the preview screen can be built now, and the PDF is a rendering of data that already exists.

Note `res.send(pdf)` rather than `ok(res, pdf)`: a PDF is bytes, not JSON, so it is the one response in the whole API that does not use the envelope. The headers say what it is and give the file a name.

---

## Four endpoints added after the original list

The endpoint list in the project spec was written before the screens existed. Four were added while building, because a screen genuinely needed them:

| Endpoint | Why |
|---|---|
| `GET /courses/{id}` | The setup screen needs the course, its topics and its holidays together |
| `GET /sessions/{id}/attendance` | The attendance *edit* screen needs what was already recorded |
| `DELETE /courses/{id}/students/{studentId}` | A student who dropped the course |
| `DELETE /materials/{id}` | Removing an uploaded file's record |

All four are in `/docs` and have been added to the endpoint list in the project spec, so the two agree exactly — 39 endpoints on each side, checked. None of them replaces or renames anything that was already published: they are additions, which is the safe direction.

!NOTE This is the pattern to follow. If the app needs a field or an endpoint that does not exist, it is *requested and added*, never invented on the client. What must not happen is a rename: three developers are building against these names.

## What is still not there

Two gaps worth naming rather than quietly adding:

*There is no `DELETE /courses/:id`.* A teacher cannot delete a course through the API. This is a real gap — the smoke test has to leave its throwaway course behind because of it. It was left out rather than invented, because the endpoint list is frozen and three developers build against it. It is a one-line addition once agreed.

*There is no `GET /courses/:id/analysis/topics`.* Topic-wise quiz analysis was removed from scope. It required the teacher to tag every quiz question with a topic by hand, which contradicts the minimum-input rule. A quiz is simply an assessment of type `quiz`, marked as a single total.

!NOTE None of the planner's graded features are affected by that removal. Slot generation, topic allocation, assessment date validation, replanning that freezes the past, and computed deficit resolution are all present and tested.
