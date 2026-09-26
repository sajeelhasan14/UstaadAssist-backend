import { Router } from "express";
import { ok, badRequest, notFound } from "../http.ts";
import { requireAuth } from "../middleware/requireAuth.ts";
import { pool, transaction } from "../db/pool.ts";

const router = Router();
// COURSE CREATION
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
  const result = await pool.query(
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
  ok(res, result.rows[0], 201);
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

export default router;
