/**
 * Reports (Module M7). The PDF renderer is a STUB.
 *
 * CLAUDE.md Section 2: "PDF generation — tool not decided yet, but the feature
 * is required and fully owned by the app. Leave a stub service with a clear
 * interface until the tool is picked."
 *
 * What is NOT a stub is the part above the renderer. Every number, every row and
 * every summary line is assembled here, by the same pure functions the screens
 * use. So when a PDF library is chosen, the only new code is "draw this object",
 * and the document cannot disagree with the app — there is nothing left for it
 * to calculate. CLAUDE.md: "Computation is a pure function, kept separate from
 * PDF rendering. Never calculate inside the PDF code."
 */

import { pool } from "../db/pool.ts";
import { AppError, badRequest } from "../http.ts";
import { assertCourseOwned } from "./ownership.ts";
import { getResults } from "./grading.service.ts";
import { getAttendanceSummary } from "./attendance.service.ts";
import { getScheduleHealth } from "./plan.service.ts";

export type ReportType = "result" | "attendance" | "course";

export const REPORT_TYPES: ReportType[] = ["result", "attendance", "course"];

/** The header every report carries, from Section 3.8. */
export type ReportHeader = {
  course_name: string;
  course_code: string | null;
  semester: string | null;
  teacher_name: string | null;
  department: string | null;
  generated_on: string;
  /** The PDF prints a blank line above this label for a hand signature. */
  signature_label: string;
};

/** Everything a report needs, fully computed. The renderer only draws it. */
export type ReportDocument = {
  type: ReportType;
  title: string;
  header: ReportHeader;
  /** Column headings, in order, for the main table. */
  columns: string[];
  /** One array of cell values per row, matching `columns`. */
  rows: (string | number | null)[][];
  /** The summary block printed under the table. */
  summary: { label: string; value: string | number }[];
  /** Notes printed at the foot, such as which marks are still missing. */
  notes: string[];
};

function asReportType(value: string): ReportType {
  if ((REPORT_TYPES as string[]).includes(value)) return value as ReportType;
  throw badRequest(`Report type must be one of: ${REPORT_TYPES.join(", ")}`);
}

async function buildHeader(
  courseId: string,
  teacherId: string,
  today: string,
): Promise<ReportHeader> {
  const course = await assertCourseOwned(courseId, teacherId);

  const teacher = await pool.query(
    `select full_name, department from teacher where id = $1`,
    [teacherId],
  );

  return {
    course_name: course.name,
    course_code: course.code,
    semester: course.semester,
    teacher_name: teacher.rows[0]?.full_name ?? null,
    department: teacher.rows[0]?.department ?? null,
    generated_on: today,
    signature_label: "Course Teacher",
  };
}

/** The result sheet — the document the whole app exists to produce. */
async function buildResultReport(
  courseId: string,
  teacherId: string,
  today: string,
): Promise<ReportDocument> {
  const header = await buildHeader(courseId, teacherId, today);
  const results = await getResults(courseId, teacherId);

  const columns = [
    "Roll No",
    "Name",
    "Quizzes",
    "Assignments",
    "Midterm",
    "Final",
    "Participation",
    "Weighted Total",
    "Grade",
  ];

  const cell = (percentage: number | null) => (percentage === null ? "—" : percentage);

  const rows = results.students.map((s) => {
    const by = new Map(s.components.map((c) => [c.component, c]));

    return [
      s.roll_no,
      s.name,
      cell(by.get("quiz")?.percentage ?? null),
      cell(by.get("assignment")?.percentage ?? null),
      cell(by.get("midterm")?.percentage ?? null),
      cell(by.get("final")?.percentage ?? null),
      cell(by.get("participation")?.percentage ?? null),
      s.weighted_total,
      s.grade,
    ];
  });

  const distribution = Object.entries(results.summary.grade_distribution)
    .filter(([, count]) => count > 0)
    .map(([grade, count]) => `${grade}: ${count}`)
    .join("   ");

  const notes: string[] = [];

  // A missing mark is named in the document rather than hidden, because the
  // total beside it is provisional until that mark is entered.
  for (const s of results.students) {
    if (!s.has_missing_marks) continue;

    const missing = s.components
      .flatMap((c) => c.missing.map((m) => m.title))
      .join(", ");

    notes.push(`${s.roll_no} ${s.name}: mark not entered for ${missing}.`);
  }

  if (notes.length > 0) {
    notes.unshift(
      "The totals below are provisional for the students listed here, " +
        "because at least one mark has not been entered. A missing mark is not counted as zero.",
    );
  }

  return {
    type: "result",
    title: "Result Sheet",
    header,
    columns,
    rows,
    summary: [
      { label: "Students", value: results.summary.student_count },
      { label: "Class average", value: results.summary.class_average ?? "—" },
      { label: "Highest", value: results.summary.highest ?? "—" },
      { label: "Lowest", value: results.summary.lowest ?? "—" },
      { label: "Grade distribution", value: distribution || "—" },
      { label: "Passed", value: results.summary.pass_count },
      { label: "Failed", value: results.summary.fail_count },
      {
        label: "Weightage",
        value: Object.entries(results.weightage)
          .map(([component, percentage]) => `${component} ${percentage}%`)
          .join("   "),
      },
    ],
    notes,
  };
}

/** The attendance report. */
async function buildAttendanceReport(
  courseId: string,
  teacherId: string,
  today: string,
): Promise<ReportDocument> {
  const header = await buildHeader(courseId, teacherId, today);
  const summary = await getAttendanceSummary(courseId, teacherId);

  return {
    type: "attendance",
    title: "Attendance Report",
    header,
    columns: ["Roll No", "Name", "Present", "Absent", "Leave", "Percentage", "Status"],
    rows: summary.students.map((s) => [
      s.roll_no,
      s.name,
      s.present,
      s.absent,
      s.leave,
      s.percentage ?? "—",
      s.percentage === null
        ? "No record"
        : s.percentage < summary.attendance_threshold
          ? "Below threshold"
          : "Eligible",
    ]),
    summary: [
      { label: "Classes held", value: summary.classes_held },
      { label: "Students", value: summary.students.length },
      { label: "Class average", value: summary.class_average ?? "—" },
      { label: "Threshold", value: `${summary.attendance_threshold}%` },
      { label: "Below threshold", value: summary.below_threshold.length },
    ],
    notes:
      summary.below_threshold.length === 0
        ? []
        : [
            `${summary.below_threshold.length} student(s) are below the ${summary.attendance_threshold}% ` +
              `attendance requirement: ` +
              summary.below_threshold.map((s) => `${s.roll_no} (${s.percentage}%)`).join(", ") +
              ".",
          ],
  };
}

/** The course report — what was planned, what was taught, and what slipped. */
async function buildCourseReport(
  courseId: string,
  teacherId: string,
  today: string,
): Promise<ReportDocument> {
  const header = await buildHeader(courseId, teacherId, today);
  const health = await getScheduleHealth(courseId, teacherId, today);

  const topics = await pool.query(
    `select t.order_no, t.title, t.sessions_needed, t.priority, t.status,
            count(s.id) filter (where s.status = 'conducted')::int as conducted,
            min(to_char(s.date, 'YYYY-MM-DD')) as first_class,
            max(to_char(s.date, 'YYYY-MM-DD')) as last_class
       from topic t
       left join session s on s.topic_id = t.id
      where t.course_id = $1
      group by t.id
      order by t.order_no`,
    [courseId],
  );

  const replans = await pool.query(
    `select to_char(triggered_at, 'YYYY-MM-DD') as on, reason
       from replan_log where course_id = $1 order by triggered_at`,
    [courseId],
  );

  const movedAssessments = await pool.query(
    `select title, move_reason from assessment
      where course_id = $1 and move_reason is not null order by date`,
    [courseId],
  );

  const notes = [
    ...replans.rows.map((r) => `Plan rebuilt on ${r.on}: ${r.reason}`),
    ...movedAssessments.rows.map((a) => a.move_reason as string),
  ];

  return {
    type: "course",
    title: "Course Report",
    header,
    columns: [
      "#",
      "Topic",
      "Classes Planned",
      "Classes Taught",
      "First Class",
      "Last Class",
      "Priority",
      "Status",
    ],
    rows: topics.rows.map((t) => [
      t.order_no,
      t.title,
      t.sessions_needed,
      t.conducted,
      t.first_class ?? "—",
      t.last_class ?? "—",
      t.priority,
      t.status,
    ]),
    summary: [
      { label: "Topics", value: topics.rowCount ?? 0 },
      { label: "Syllabus covered", value: `${health.syllabus_percent}%` },
      { label: "Classes conducted", value: health.conducted },
      { label: "Classes cancelled", value: health.cancelled },
      { label: "Total classes planned", value: health.total_sessions },
      { label: "Weeks behind plan", value: health.behind_by_weeks },
      { label: "Times replanned", value: replans.rowCount ?? 0 },
    ],
    notes,
  };
}

/**
 * Assemble a report. This part is finished and needs no PDF tool — it returns
 * the complete document as data, which is also what the preview screen shows.
 */
export async function buildReport(
  courseId: string,
  teacherId: string,
  type: string,
  today: string,
): Promise<ReportDocument> {
  switch (asReportType(type)) {
    case "result":
      return buildResultReport(courseId, teacherId, today);
    case "attendance":
      return buildAttendanceReport(courseId, teacherId, today);
    case "course":
      return buildCourseReport(courseId, teacherId, today);
  }
}

/**
 * TODO: implement once the PDF tool is chosen.
 *
 * It takes a finished ReportDocument and returns the bytes. It does no
 * arithmetic, no database access and no formatting decisions beyond layout —
 * every value it prints is already in the object it is handed.
 */
export async function renderReportPdf(_document: ReportDocument): Promise<Buffer> {
  throw new AppError(
    503,
    "PDF rendering is not configured yet. " +
      "Request the same report without .pdf to get the finished report as JSON.",
  );
}
