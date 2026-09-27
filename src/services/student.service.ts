/**
 * Students and enrollment (Module M5).
 *
 * The teacher never types a class list. They photograph it, the extractor
 * returns a draft, they fix it on the review screen, and only then does it reach
 * this file. See CLAUDE.md Section 3.7.
 *
 * So `importStudents` receives rows the teacher has already confirmed. Its job
 * is to refuse anything still broken, then save.
 */

import { pool, transaction } from "../db/pool.ts";
import { badRequest } from "../http.ts";
import { assertCourseOwned, assertStudentOwned } from "./ownership.ts";

export type ReviewedStudent = { roll_no: string; name: string };

/**
 * Check the confirmed rows before they touch the database.
 *
 * These are the same problems the review screen highlights. They are checked
 * again here because the screen is a convenience and the server is the rule:
 * a second app, an old build, or a replayed request must not get past them.
 */
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

    // Duplicates are refused, never merged. Two students with the same roll
    // number means one of them was misread, and merging would lose a student.
    const earlier = seen.get(rollNo.toUpperCase());
    if (earlier !== undefined) {
      throw badRequest(`Roll number ${rollNo} appears twice, on rows ${earlier} and ${line}`);
    }
    seen.set(rollNo.toUpperCase(), line);

    rows.push({ roll_no: rollNo, name });
  });

  return rows;
}

/**
 * POST /courses/:id/students/import — save the reviewed, confirmed list.
 *
 * A student belongs to the teacher, not to one course, so the same person keeps
 * one row across every course they take. That is why `student` is unique on
 * (teacher_id, roll_no) and enrollment is a separate table.
 */
export async function importStudents(
  courseId: string,
  teacherId: string,
  body: { students?: unknown },
) {
  await assertCourseOwned(courseId, teacherId);
  const rows = validateRows(body.students);

  return transaction(async (client) => {
    // Insert the students this teacher has not seen before. If the roll number
    // already exists, keep the row and refresh the name — the teacher may have
    // just corrected a spelling on the review screen.
    const students = await client.query(
      `insert into student (teacher_id, roll_no, name)
       select $1, r.roll_no, r.name
         from unnest($2::text[], $3::text[]) as r(roll_no, name)
       on conflict (teacher_id, roll_no) do update set name = excluded.name
       returning id, roll_no, name`,
      [teacherId, rows.map((r) => r.roll_no), rows.map((r) => r.name)],
    );

    const enrolled = await client.query(
      `insert into enrollment (course_id, student_id)
       select $1, id from unnest($2::bigint[]) as id
       on conflict (course_id, student_id) do nothing
       returning student_id`,
      [courseId, students.rows.map((s) => s.id)],
    );

    return {
      students: students.rows,
      saved: students.rowCount,
      newly_enrolled: enrolled.rowCount,
    };
  });
}

/** GET /courses/:id/students — the class list with each student's attendance. */
export async function listStudents(courseId: string, teacherId: string) {
  const course = await assertCourseOwned(courseId, teacherId);

  const result = await pool.query(
    `with conducted as (
       select id from session where course_id = $1 and status = 'conducted'
     )
     select s.id, s.roll_no, s.name,
            count(a.id) filter (where a.status = 'present')::int as present,
            count(a.id) filter (where a.status = 'absent')::int  as absent,
            case
              when count(a.id) filter (where a.status <> 'leave') = 0 then null
              else round(
                100.0 * count(a.id) filter (where a.status = 'present')
                      / count(a.id) filter (where a.status <> 'leave'), 2)
            end as attendance_percentage
       from enrollment e
       join student s on s.id = e.student_id
       left join attendance a on a.student_id = s.id and a.session_id in (select id from conducted)
      where e.course_id = $1
      group by s.id, s.roll_no, s.name
      order by s.roll_no`,
    [courseId],
  );

  const threshold = Number(course.attendance_threshold);

  return result.rows.map((r) => ({
    ...r,
    attendance_percentage:
      r.attendance_percentage === null ? null : Number(r.attendance_percentage),
    below_threshold:
      r.attendance_percentage !== null && Number(r.attendance_percentage) < threshold,
  }));
}

/** DELETE-free: remove one student from one course, keeping the student row. */
export async function unenrollStudent(
  courseId: string,
  studentId: string,
  teacherId: string,
) {
  await assertCourseOwned(courseId, teacherId);
  await assertStudentOwned(studentId, teacherId);

  const result = await pool.query(
    `delete from enrollment where course_id = $1 and student_id = $2 returning student_id`,
    [courseId, studentId],
  );

  return { removed: result.rowCount ?? 0 };
}

/** GET /students/:id — one student's full record across a course. */
export async function getStudent(studentId: string, teacherId: string) {
  const student = await assertStudentOwned(studentId, teacherId);

  const attendance = await pool.query(
    `select c.id as course_id, c.name as course_name,
            to_char(se.date, 'YYYY-MM-DD') as date,
            t.title as topic_title, a.status
       from attendance a
       join session se on se.id = a.session_id
       join course  c  on c.id = se.course_id
       left join topic t on t.id = se.topic_id
      where a.student_id = $1 and c.teacher_id = $2
      order by se.date`,
    [studentId, teacherId],
  );

  const marks = await pool.query(
    `select c.id as course_id, c.name as course_name,
            a.id as assessment_id, a.type, a.title, a.total_marks,
            m.obtained, m.is_absent
       from mark m
       join assessment a on a.id = m.assessment_id
       join course c on c.id = a.course_id
      where m.student_id = $1 and c.teacher_id = $2
      order by a.date nulls last, a.id`,
    [studentId, teacherId],
  );

  return {
    ...student,
    attendance: attendance.rows,
    marks: marks.rows.map((m) => ({
      ...m,
      total_marks: Number(m.total_marks),
      // NULL stays NULL. A mark that was never entered is missing, not zero.
      obtained: m.obtained === null ? null : Number(m.obtained),
    })),
  };
}
