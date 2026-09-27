/**
 * Attendance — Module M3.
 *
 * Design rule from CLAUDE.md Section 1: everyone is PRESENT by default and the
 * teacher taps only the absentees. So the app sends the short list, not the long
 * one, and this file fills in "present" for everybody else.
 */

import { pool, transaction } from "../db/pool.ts";
import { badRequest } from "../http.ts";
import { assertCourseOwned, assertSessionOwned } from "./ownership.ts";
import { refreshTopicStatus } from "./session.service.ts";

/** Read a list of student ids out of the request body. */
function idList(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw badRequest(`${field} must be an array of student ids`);

  return value.map((v) => {
    if (typeof v === "number") return String(v);
    if (typeof v === "string" && v.trim() !== "") return v.trim();
    throw badRequest(`${field} contains something that is not a student id`);
  });
}

/**
 * POST /sessions/:id/attendance
 *
 * Body: { absent: [12, 40], leave: [7] }
 *
 * Everybody enrolled in the course who is not named is marked present.
 * Re-submitting simply overwrites, so the teacher can fix a mistake.
 */
export async function submitAttendance(
  sessionId: string,
  teacherId: string,
  body: { absent?: unknown; leave?: unknown },
) {
  const courseId = await assertSessionOwned(sessionId, teacherId);

  const absent = idList(body.absent, "absent");
  const onLeave = idList(body.leave, "leave");

  const clash = absent.filter((id) => onLeave.includes(id));
  if (clash.length > 0) {
    throw badRequest("A student cannot be both absent and on leave");
  }

  return transaction(async (client) => {
    // One statement marks the whole class. Every enrolled student gets a row:
    // 'absent' or 'leave' if the teacher named them, otherwise 'present'.
    const result = await client.query(
      `insert into attendance (session_id, student_id, status)
       select $1,
              e.student_id,
              case
                when e.student_id = any($3::bigint[]) then 'absent'
                when e.student_id = any($4::bigint[]) then 'leave'
                else 'present'
              end
         from enrollment e
        where e.course_id = $2
       on conflict (session_id, student_id) do update
          set status    = excluded.status,
              marked_at = now()
       returning student_id, status`,
      [sessionId, courseId, absent, onLeave],
    );

    if (result.rowCount === 0) {
      throw badRequest("No students are enrolled in this course yet");
    }

    // Taking attendance means the class happened.
    const conducted = await client.query(
      `update session set status = 'conducted', updated_at = now()
        where id = $1 and status = 'planned'
        returning topic_id`,
      [sessionId],
    );

    // Marking the class conducted can complete its topic, so the topic status is
    // recalculated here too. Without this the dashboard would report almost no
    // syllabus covered, because most classes are marked conducted by taking
    // attendance rather than through PATCH /sessions/:id.
    const topicId = conducted.rows[0]?.topic_id;
    if (topicId !== undefined && topicId !== null) {
      await refreshTopicStatus(client, String(topicId));
    }

    const counts = {
      present: result.rows.filter((r) => r.status === "present").length,
      absent: result.rows.filter((r) => r.status === "absent").length,
      leave: result.rows.filter((r) => r.status === "leave").length,
    };

    return { session_id: Number(sessionId), marked: result.rowCount, ...counts };
  });
}

/** GET /sessions/:id/attendance — what was already recorded, for the edit screen. */
export async function getSessionAttendance(sessionId: string, teacherId: string) {
  const courseId = await assertSessionOwned(sessionId, teacherId);

  const result = await pool.query(
    `select s.id as student_id, s.roll_no, s.name,
            coalesce(a.status, 'present') as status,
            (a.id is not null) as recorded
       from enrollment e
       join student s on s.id = e.student_id
       left join attendance a on a.student_id = s.id and a.session_id = $1
      where e.course_id = $2
      order by s.roll_no`,
    [sessionId, courseId],
  );

  return result.rows;
}

/**
 * GET /courses/:id/attendance/summary
 *
 * A percentage per student, plus the list of students below the course's
 * threshold — the ones at risk of being barred from the exam.
 *
 * Only conducted classes count in the denominator. A cancelled class was never
 * an opportunity to attend, so counting it would punish the student for the
 * teacher's cancellation. A class marked 'leave' is excused: it is removed from
 * the denominator rather than counted as an absence.
 */
export async function getAttendanceSummary(courseId: string, teacherId: string) {
  const course = await assertCourseOwned(courseId, teacherId);
  const threshold = Number(course.attendance_threshold);

  const result = await pool.query(
    `with conducted as (
       select id from session where course_id = $1 and status = 'conducted'
     )
     select s.id as student_id, s.roll_no, s.name,
            count(a.id) filter (where a.status = 'present')::int as present,
            count(a.id) filter (where a.status = 'absent')::int  as absent,
            count(a.id) filter (where a.status = 'leave')::int   as leave,
            (select count(*) from conducted)::int                as classes_held,
            case
              when count(a.id) filter (where a.status <> 'leave') = 0 then null
              else round(
                100.0 * count(a.id) filter (where a.status = 'present')
                      / count(a.id) filter (where a.status <> 'leave'), 2)
            end as percentage
       from enrollment e
       join student s on s.id = e.student_id
       left join attendance a on a.student_id = s.id and a.session_id in (select id from conducted)
      where e.course_id = $1
      group by s.id, s.roll_no, s.name
      order by s.roll_no`,
    [courseId],
  );

  const students = result.rows.map((r) => ({
    ...r,
    percentage: r.percentage === null ? null : Number(r.percentage),
  }));

  const withMarks = students.filter((s) => s.percentage !== null);
  const belowThreshold = withMarks.filter((s) => s.percentage! < threshold);

  return {
    attendance_threshold: threshold,
    classes_held: students[0]?.classes_held ?? 0,
    class_average:
      withMarks.length === 0
        ? null
        : Math.round(
            (withMarks.reduce((sum, s) => sum + s.percentage!, 0) / withMarks.length) * 100,
          ) / 100,
    students,
    below_threshold: belowThreshold,
  };
}
