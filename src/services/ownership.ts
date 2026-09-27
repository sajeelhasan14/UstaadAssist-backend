/**
 * Ownership checks.
 *
 * Every route that takes an `:id` from the URL has to prove that the row
 * belongs to the signed-in teacher. The teacher's id always comes from
 * `req.auth` — the verified token — and never from the request body.
 *
 * When a row exists but belongs to somebody else we answer 404, not 403.
 * A 403 would confirm that the id is real, which quietly tells an attacker
 * how many courses exist and lets them probe for them.
 */

import { pool } from "../db/pool.ts";
import { notFound } from "../http.ts";

export type CourseRow = {
  id: string;
  teacher_id: string;
  name: string;
  code: string | null;
  semester: string | null;
  start_date: string;
  end_date: string;
  class_days: string[];
  attendance_threshold: string;
};

/** Fetch a course, but only if this teacher owns it. */
export async function assertCourseOwned(
  courseId: string,
  teacherId: string,
): Promise<CourseRow> {
  const result = await pool.query<CourseRow>(
    `select id, teacher_id, name, code, semester,
            to_char(start_date, 'YYYY-MM-DD') as start_date,
            to_char(end_date,   'YYYY-MM-DD') as end_date,
            class_days, attendance_threshold
       from course
      where id = $1 and teacher_id = $2`,
    [courseId, teacherId],
  );

  const course = result.rows[0];
  if (!course) throw notFound("Course");
  return course;
}

/**
 * For routes shaped like PATCH /sessions/:id, where the URL carries a child row
 * and the teacher is two joins away. The child's course_id is returned so the
 * caller can use it.
 */
async function ownedChild(
  table: "session" | "topic" | "assessment" | "material",
  childId: string,
  teacherId: string,
  label: string,
): Promise<string> {
  const result = await pool.query(
    `select x.course_id
       from ${table} x
       join course c on c.id = x.course_id
      where x.id = $1 and c.teacher_id = $2`,
    [childId, teacherId],
  );

  const row = result.rows[0];
  if (!row) throw notFound(label);
  return String(row.course_id);
}

export const assertSessionOwned = (id: string, teacherId: string) =>
  ownedChild("session", id, teacherId, "Session");

export const assertTopicOwned = (id: string, teacherId: string) =>
  ownedChild("topic", id, teacherId, "Topic");

export const assertAssessmentOwned = (id: string, teacherId: string) =>
  ownedChild("assessment", id, teacherId, "Assessment");

/** A student is owned directly by the teacher, not through a course. */
export async function assertStudentOwned(
  studentId: string,
  teacherId: string,
): Promise<{ id: string; roll_no: string; name: string }> {
  const result = await pool.query(
    `select id, roll_no, name from student where id = $1 and teacher_id = $2`,
    [studentId, teacherId],
  );

  const row = result.rows[0];
  if (!row) throw notFound("Student");
  return row;
}
