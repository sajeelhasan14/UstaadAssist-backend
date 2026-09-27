import { Router } from "express";
import { ok, badRequest, notFound, pathId } from "../http.ts";
import { requireAuth } from "../middleware/requireAuth.ts";
import { holidaysBetween } from "../data/pakHolidays.ts";
import { pool, transaction } from "../db/pool.ts";

import {
  listCourses,
  getCourse,
  updateCourse,
  cloneCourse,
} from "../services/course.service.ts";
import { importStudents, listStudents, unenrollStudent } from "../services/student.service.ts";
import { extractStudents, extractTopics } from "../services/extraction.service.ts";
import { getAttendanceSummary } from "../services/attendance.service.ts";
import {
  createAssessment,
  listAssessments,
  getResults,
  getWeightage,
  setWeightage,
  getGradeScale,
  setGradeScale,
} from "../services/grading.service.ts";
import { saveMaterial, listMaterials } from "../services/material.service.ts";
import { getDashboard } from "../services/dashboard.service.ts";
import { buildReport, renderReportPdf } from "../services/report.service.ts";

const router = Router();

/** The date the server treats as "now", overridable for demos and tests. */
function today(value: unknown): string {
  if (value === undefined) return new Date().toISOString().slice(0, 10);
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw badRequest("today must be a date in YYYY-MM-DD form");
  }
  return value;
}

// COURSE CREATION WITH HOLIDAY CREATION
router.post("/", requireAuth, async (req, res) => {
  const { name, code, semester, start_date, end_date, class_days } = req.body;
  if (!name) {
    throw badRequest("name is required");
  }
  if (!start_date || !end_date) {
    throw badRequest("start_date and end_date are required");
  }
  if (!Array.isArray(class_days) || class_days.length === 0) {
    throw badRequest("class_days must be a non-empty array");
  }
  const course = await transaction(async (client) => {
    const created = await client.query(
      `insert into course (teacher_id, name, code, semester, start_date, end_date, class_days)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning *`,
      [
        req.auth!.userId,
        name,
        code ?? null,
        semester ?? null,
        start_date,
        end_date,
        class_days,
      ],
    );

    const newCourse = created.rows[0];
    const holidays = holidaysBetween(start_date, end_date);

    if (holidays.length > 0) {
      await client.query(
        `insert into holiday (course_id, date, name)
         select $1, d, n
         from unnest($2::date[], $3::text[]) as t(d, n)`,
        [
          newCourse.id,
          holidays.map((h) => h.date),
          holidays.map((h) => h.name),
        ],
      );
    }

    return newCourse;
  });

  ok(res, course, 201);
});

// COURSE TOPICS CREATION
router.post("/:courseId/topics", requireAuth, async (req, res) => {
  const { raw } = req.body;

  if (typeof raw !== "string" || raw.trim() === "") {
    throw badRequest("raw is required");
  }

  const titles = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  if (titles.length === 0) {
    throw badRequest("No topics found");
  }

  const course = await pool.query(
    "select id from course where id = $1 and teacher_id = $2",
    [req.params.courseId, req.auth!.userId],
  );
  if (course.rowCount === 0) {
    throw notFound("Course");
  }

  const topics = await transaction(async (client) => {
    await client.query("delete from topic where course_id = $1", [
      req.params.courseId,
    ]);

    const inserted = await client.query(
      `insert into topic (course_id, order_no, title)
       select $1, ordinality, title
       from unnest($2::text[]) with ordinality as t(title, ordinality)
       returning *`,
      [req.params.courseId, titles],
    );

    return inserted.rows;
  });

  ok(res, topics);
});

// GET HOLIDAY
router.get("/:courseId/holidays", requireAuth, async (req, res) => {
  const course = await pool.query(
    "select id from course where id = $1 and teacher_id = $2",
    [req.params.courseId, req.auth!.userId],
  );
  if (course.rowCount === 0) throw notFound("Course");

  const result = await pool.query(
    `select id, date, name, is_active, source
     from holiday where course_id = $1 order by date`,
    [req.params.courseId],
  );

  ok(res, result.rows);
});

// HOLIDAY SELECTION
router.post("/:courseId/holidays", requireAuth, async (req, res) => {
  const { holidays } = req.body;

  if (!Array.isArray(holidays)) {
    throw badRequest("holidays must be an array of { id, is_active }");
  }

  const course = await pool.query(
    "select id from course where id = $1 and teacher_id = $2",
    [req.params.courseId, req.auth!.userId],
  );
    if (course.rowCount === 0) throw notFound("Course");

    // We can do this but this will cause 8 trips to the database not 1 
    
    // for (const h of holidays) {
    //   await pool.query(
    //     "update holiday set is_active = $1 where id = $2 and course_id = $3",
    //     [h.is_active, h.id, req.params.courseId],
    //   );
    // }

  const result = await pool.query(
    `update holiday h
     set is_active = v.is_active
     from unnest($2::bigint[], $3::boolean[]) as v(id, is_active)
     where h.id = v.id and h.course_id = $1
     returning h.id, h.date, h.name, h.is_active, h.source`,
    [
      req.params.courseId,
      holidays.map((h) => h.id),
      holidays.map((h) => h.is_active),
    ],
  );

  ok(res, result.rows);
});

// ------------------------------------------------------- course list & edit

// GET /courses — the teacher's courses
router.get("/", requireAuth, async (req, res) => {
  ok(res, await listCourses(req.auth!.userId));
});

// GET /courses/:courseId — one course with its topics and holidays
router.get("/:courseId", requireAuth, async (req, res) => {
  ok(res, await getCourse(pathId(req.params, "courseId"), req.auth!.userId));
});

// PATCH /courses/:courseId — edit settings (dates, class days, threshold)
router.patch("/:courseId", requireAuth, async (req, res) => {
  ok(res, await updateCourse(pathId(req.params, "courseId"), req.auth!.userId, req.body ?? {}));
});

// POST /courses/:courseId/clone — start next semester from this course
router.post("/:courseId/clone", requireAuth, async (req, res) => {
  const clone = await cloneCourse(
    pathId(req.params, "courseId"),
    req.auth!.userId,
    req.body ?? {},
  );
  ok(res, clone, 201);
});

// ------------------------------------------------------------- import flows

/**
 * POST /courses/:courseId/outline/import
 *
 * The app has already uploaded the outline to Supabase Storage and sends us the
 * path. NOTHING IS SAVED here — the extracted topics go back for review, and the
 * teacher confirms them through POST /courses/:id/topics.
 */
router.post("/:courseId/outline/import", requireAuth, async (req, res) => {
  const courseId = pathId(req.params, "courseId");

  const storagePath = typeof req.body?.storage_path === "string" ? req.body.storage_path : "";
  if (storagePath === "") {
    throw badRequest("storage_path is required — upload the file to Supabase Storage first");
  }

  const course = await pool.query(
    "select id from course where id = $1 and teacher_id = $2",
    [courseId, req.auth!.userId],
  );
  if (course.rowCount === 0) throw notFound("Course");

  const extracted = await extractTopics(storagePath);

  ok(res, {
    ...extracted,
    saved: false,
    next_step: "Show these on the review screen, then POST them to /courses/:id/topics",
  });
});

/**
 * POST /courses/:courseId/students/extract
 *
 * Photo or PDF of the class list -> parsed rows for review. NOTHING IS SAVED.
 *
 * Section 3.7 is explicit about why: a misread roll number (CT-21001 read as
 * CT-2100I) would silently corrupt that student's attendance and result for the
 * whole semester. The extraction is a draft; the teacher's confirmation through
 * /students/import is the source of truth.
 */
router.post("/:courseId/students/extract", requireAuth, async (req, res) => {
  const courseId = pathId(req.params, "courseId");

  const storagePath = typeof req.body?.storage_path === "string" ? req.body.storage_path : "";
  if (storagePath === "") {
    throw badRequest("storage_path is required — upload the photo to Supabase Storage first");
  }

  const course = await pool.query(
    "select id from course where id = $1 and teacher_id = $2",
    [courseId, req.auth!.userId],
  );
  if (course.rowCount === 0) throw notFound("Course");

  const extracted = await extractStudents(storagePath);

  ok(res, {
    ...extracted,
    saved: false,
    next_step: "Show these on the review screen, then POST them to /courses/:id/students/import",
  });
});

// POST /courses/:courseId/students/import — save the reviewed, confirmed list
router.post("/:courseId/students/import", requireAuth, async (req, res) => {
  const result = await importStudents(
    pathId(req.params, "courseId"),
    req.auth!.userId,
    req.body ?? {},
  );
  ok(res, result, 201);
});

// ---------------------------------------------------------------- students

// GET /courses/:courseId/students — the class list with attendance percentages
router.get("/:courseId/students", requireAuth, async (req, res) => {
  ok(res, await listStudents(pathId(req.params, "courseId"), req.auth!.userId));
});

// DELETE /courses/:courseId/students/:studentId — remove one student from this course
router.delete("/:courseId/students/:studentId", requireAuth, async (req, res) => {
  const result = await unenrollStudent(
    pathId(req.params, "courseId"),
    pathId(req.params, "studentId"),
    req.auth!.userId,
  );
  ok(res, result);
});

// GET /courses/:courseId/attendance/summary — percentages + below-threshold list
router.get("/:courseId/attendance/summary", requireAuth, async (req, res) => {
  ok(res, await getAttendanceSummary(pathId(req.params, "courseId"), req.auth!.userId));
});

// ------------------------------------------------------- assessments & marks

// POST /courses/:courseId/assessments — create a quiz, assignment, midterm or final
router.post("/:courseId/assessments", requireAuth, async (req, res) => {
  const created = await createAssessment(
    pathId(req.params, "courseId"),
    req.auth!.userId,
    req.body ?? {},
  );
  ok(res, created, 201);
});

// GET /courses/:courseId/assessments — list them, with how many marks are in
router.get("/:courseId/assessments", requireAuth, async (req, res) => {
  ok(res, await listAssessments(pathId(req.params, "courseId"), req.auth!.userId));
});

// GET /courses/:courseId/results — weighted totals and grades
router.get("/:courseId/results", requireAuth, async (req, res) => {
  ok(res, await getResults(pathId(req.params, "courseId"), req.auth!.userId));
});

// GET /courses/:courseId/weightage — component percentages
router.get("/:courseId/weightage", requireAuth, async (req, res) => {
  ok(res, await getWeightage(pathId(req.params, "courseId"), req.auth!.userId));
});

// PUT /courses/:courseId/weightage — edit them (must total 100)
router.put("/:courseId/weightage", requireAuth, async (req, res) => {
  ok(res, await setWeightage(pathId(req.params, "courseId"), req.auth!.userId, req.body ?? {}));
});

// GET /courses/:courseId/grade-scale — the course grade scale
router.get("/:courseId/grade-scale", requireAuth, async (req, res) => {
  ok(res, await getGradeScale(pathId(req.params, "courseId"), req.auth!.userId));
});

// PUT /courses/:courseId/grade-scale — edit the grade scale
router.put("/:courseId/grade-scale", requireAuth, async (req, res) => {
  ok(res, await setGradeScale(pathId(req.params, "courseId"), req.auth!.userId, req.body ?? {}));
});

// ---------------------------------------------------- material & dashboard

// POST /courses/:courseId/materials — save the record after a Supabase upload
router.post("/:courseId/materials", requireAuth, async (req, res) => {
  const created = await saveMaterial(
    pathId(req.params, "courseId"),
    req.auth!.userId,
    req.body ?? {},
  );
  ok(res, created, 201);
});

// GET /courses/:courseId/materials — the saved records, grouped by topic
router.get("/:courseId/materials", requireAuth, async (req, res) => {
  ok(res, await listMaterials(pathId(req.params, "courseId"), req.auth!.userId));
});

// GET /courses/:courseId/dashboard — every dashboard number in one response
router.get("/:courseId/dashboard", requireAuth, async (req, res) => {
  const dashboard = await getDashboard(
    pathId(req.params, "courseId"),
    req.auth!.userId,
    today(req.query.today),
  );
  ok(res, dashboard);
});

// ------------------------------------------------------------------ reports

/**
 * GET /courses/:courseId/reports/:type.pdf
 *
 * `:type` arrives as "result.pdf", "attendance.pdf" or "course.pdf". Asking for
 * the same type without .pdf returns the finished report as JSON, which is what
 * the preview screen shows and what works today while the PDF tool is still
 * being chosen.
 */
router.get("/:courseId/reports/:type", requireAuth, async (req, res) => {
  const requested = pathId(req.params, "type");
  const wantsPdf = requested.endsWith(".pdf");
  const type = wantsPdf ? requested.slice(0, -".pdf".length) : requested;

  const document = await buildReport(
    pathId(req.params, "courseId"),
    req.auth!.userId,
    type,
    today(req.query.today),
  );

  if (!wantsPdf) {
    ok(res, document);
    return;
  }

  const pdf = await renderReportPdf(document);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${type}-${document.header.generated_on}.pdf"`,
  );
  res.send(pdf);
});

export default router;
