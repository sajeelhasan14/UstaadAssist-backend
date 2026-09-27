/**
 * The dashboard (Module M7).
 *
 * CLAUDE.md: "All numbers in one endpoint." One screen, one request. Anything
 * the dashboard shows is computed here, so the app never has to fire six calls
 * and stitch them together.
 */

import { pool } from "../db/pool.ts";
import { assertCourseOwned } from "./ownership.ts";
import { getScheduleHealth } from "./plan.service.ts";
import { getAttendanceSummary } from "./attendance.service.ts";
import { getResults } from "./grading.service.ts";

export async function getDashboard(courseId: string, teacherId: string, today: string) {
  const course = await assertCourseOwned(courseId, teacherId);

  const health = await getScheduleHealth(courseId, teacherId, today);
  const attendance = await getAttendanceSummary(courseId, teacherId);

  const topics = await pool.query(
    `select count(*)::int                                          as total,
            count(*) filter (where status = 'completed')::int       as completed,
            count(*) filter (where status = 'in_progress')::int     as in_progress,
            count(*) filter (where status = 'pending')::int         as pending,
            count(*) filter (where status = 'dropped')::int         as dropped
       from topic where course_id = $1`,
    [courseId],
  );

  const nextSession = await pool.query(
    `select s.id, to_char(s.date, 'YYYY-MM-DD') as date, s.week_no,
            t.title as topic_title, s.part_no, s.total_parts
       from session s
       left join topic t on t.id = s.topic_id
      where s.course_id = $1 and s.status = 'planned' and s.date >= $2
      order by s.date
      limit 1`,
    [courseId, today],
  );

  const upcomingAssessments = await pool.query(
    `select id, type, title, to_char(date, 'YYYY-MM-DD') as date, total_marks,
            to_char(original_date, 'YYYY-MM-DD') as original_date, move_reason
       from assessment
      where course_id = $1 and date >= $2
      order by date
      limit 5`,
    [courseId, today],
  );

  const marksOutstanding = await pool.query(
    `select a.id, a.type, a.title,
            (select count(*) from enrollment e where e.course_id = a.course_id)::int as expected,
            count(m.id) filter (where m.obtained is not null or m.is_absent)::int    as entered
       from assessment a
       left join mark m on m.assessment_id = a.id
      where a.course_id = $1
      group by a.id
     having count(m.id) filter (where m.obtained is not null or m.is_absent)
            < (select count(*) from enrollment e where e.course_id = a.course_id)
      order by a.date nulls last`,
    [courseId],
  );

  const lastReplan = await pool.query(
    `select triggered_at, reason from replan_log
      where course_id = $1 order by triggered_at desc limit 1`,
    [courseId],
  );

  // The results are only meaningful once there is something to grade.
  const hasStudents = attendance.students.length > 0;
  const results = hasStudents ? await getResults(courseId, teacherId) : null;

  return {
    course: {
      id: Number(course.id),
      name: course.name,
      code: course.code,
      semester: course.semester,
      start_date: course.start_date,
      end_date: course.end_date,
      class_days: course.class_days,
      attendance_threshold: Number(course.attendance_threshold),
    },
    today,

    schedule: {
      ...health,
      // The exact sentence the dashboard shows the teacher.
      warning:
        health.behind_by_weeks >= 0.5
          ? `You are ${health.behind_by_weeks} week${health.behind_by_weeks === 1 ? "" : "s"} behind your plan.`
          : null,
    },

    topics: topics.rows[0],

    next_session: nextSession.rows[0] ?? null,

    attendance: {
      classes_held: attendance.classes_held,
      class_average: attendance.class_average,
      student_count: attendance.students.length,
      below_threshold_count: attendance.below_threshold.length,
      below_threshold: attendance.below_threshold.map((s) => ({
        student_id: s.student_id,
        roll_no: s.roll_no,
        name: s.name,
        percentage: s.percentage,
      })),
    },

    assessments: {
      upcoming: upcomingAssessments.rows.map((a) => ({
        ...a,
        total_marks: Number(a.total_marks),
      })),
      marks_outstanding: marksOutstanding.rows,
    },

    results:
      results === null
        ? null
        : {
            class_average: results.summary.class_average,
            highest: results.summary.highest,
            lowest: results.summary.lowest,
            grade_distribution: results.summary.grade_distribution,
            pass_count: results.summary.pass_count,
            fail_count: results.summary.fail_count,
            students_with_missing_marks: results.summary.students_with_missing_marks,
          },

    last_replan: lastReplan.rows[0] ?? null,
  };
}
