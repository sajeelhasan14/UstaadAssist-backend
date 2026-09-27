/**
 * Every shape the API accepts or returns, as Zod schemas.
 *
 * This file is the single source of truth for the API contract. From these
 * schemas we get:
 *
 *   - the OpenAPI spec at /openapi.json
 *   - the Swagger UI at /docs
 *   - request validation (src/middleware/validate.ts)
 *   - TypeScript types, via z.infer, for anything that wants them
 *
 * So a field cannot exist in the docs and not in the validation, or vice versa.
 * There is no separate document to keep in step.
 *
 * Naming note: every field is snake_case, matching the database columns, because
 * there is no mapping layer between SQL and JSON.
 */

import { z } from "./zod.ts";

// ------------------------------------------------------------- primitives

/** "2026-09-01". Dates are plain strings everywhere, never timestamps. */
export const DateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date in YYYY-MM-DD form")
  .openapi({ example: "2026-09-01", description: "A calendar date, YYYY-MM-DD" });

export const DayName = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

export const ClassDays = z
  .array(DayName)
  .min(1, "at least one class day is required")
  .max(7)
  .openapi({ example: ["mon", "wed"], description: "The days of the week class is held" });

export const Priority = z.enum(["low", "normal", "high"]);
export const TopicStatus = z.enum(["pending", "in_progress", "completed", "dropped"]);
export const SessionStatus = z.enum(["planned", "conducted", "cancelled"]);
export const SessionKind = z.enum(["regular", "makeup", "revision"]);
export const AttendanceStatus = z.enum(["present", "absent", "leave"]);
export const ComponentType = z.enum([
  "quiz",
  "assignment",
  "midterm",
  "final",
  "participation",
]);
export const ReportType = z.enum(["result", "attendance", "course"]);

/**
 * A database id.
 *
 * Every id column is `bigserial`, and the `pg` driver returns bigint as a STRING
 * so no precision is lost. So ids arrive at the app as strings like "8", not as
 * numbers. That is deliberate and the app should treat them as opaque.
 */
export const Id = z.string().openapi({ example: "8", description: "Row id (bigint, sent as a string)" });

/** An id in a request body, where the app may send either form. */
export const IdInput = z.union([z.string(), z.number().int()]).openapi({ example: 12 });

/** A percentage 0-100 with two decimal places, or null when not yet known. */
export const Percentage = z.number().nullable().openapi({ example: 86.42 });

// ---------------------------------------------------------------- entities

export const Teacher = z
  .object({
    id: z.string().uuid().openapi({ description: "The Supabase user id" }),
    email: z.string(),
    full_name: z.string().nullable(),
    department: z.string().nullable(),
    created_at: z.string(),
  })
  .openapi("Teacher");

export const Course = z
  .object({
    id: Id,
    name: z.string().openapi({ example: "Database Systems" }),
    code: z.string().nullable().openapi({ example: "CS-301" }),
    semester: z.string().nullable().openapi({ example: "Fall 2026" }),
    start_date: DateString,
    end_date: DateString,
    class_days: ClassDays,
    attendance_threshold: z.number().openapi({ example: 75 }),
  })
  .openapi("Course");

export const CourseListItem = Course.extend({
  created_at: z.string(),
  topic_count: z.number().int(),
  student_count: z.number().int(),
  session_count: z.number().int(),
  conducted_count: z.number().int(),
  has_plan: z.boolean().openapi({ description: "True once the planner has been run" }),
}).openapi("CourseListItem");

export const Topic = z
  .object({
    id: Id,
    order_no: z.number().int().openapi({ example: 3 }),
    title: z.string().openapi({ example: "Entity Relationship Modelling" }),
    sessions_needed: z.number().int().openapi({ example: 3, description: "How many classes this topic needs" }),
    min_sessions: z.number().int().openapi({ example: 2, description: "The fewest it can be compressed to" }),
    priority: Priority,
    status: TopicStatus,
  })
  .openapi("Topic");

export const Holiday = z
  .object({
    id: Id,
    date: DateString,
    name: z.string().nullable().openapi({ example: "Defence Day" }),
    is_active: z.boolean().openapi({ description: "Unticked holidays are ignored by the planner" }),
    source: z.enum(["preloaded", "custom"]),
  })
  .openapi("Holiday");

export const CourseDetail = Course.extend({
  topics: z.array(Topic),
  holidays: z.array(Holiday),
}).openapi("CourseDetail");

export const Session = z
  .object({
    id: Id,
    date: DateString,
    week_no: z.number().int().openapi({ example: 12, description: "Week 1 is the first week of the course" }),
    topic_id: Id.nullable(),
    topic_title: z.string().nullable(),
    part_no: z.number().int().nullable().openapi({ description: "2 of 3, when a topic spans several classes" }),
    total_parts: z.number().int().nullable(),
    status: SessionStatus,
    kind: SessionKind,
    cancel_reason: z.string().nullable(),
  })
  .openapi("Session");

/**
 * A class as the PLANNER produces it, before it is saved.
 *
 * Note this has no `id` and no `status` — it does not exist in the database yet.
 * This is what /plan/generate and /plan/replan return.
 */
export const PlannedSession = z
  .object({
    date: DateString,
    week_no: z.number().int(),
    topic_id: z.number().int(),
    part_no: z.number().int().nullable(),
    total_parts: z.number().int().nullable(),
  })
  .openapi("PlannedSession");

export const PlannerTopic = z
  .object({
    id: z.number().int(),
    order_no: z.number().int(),
    title: z.string(),
    sessions_needed: z.number().int(),
    min_sessions: z.number().int(),
    priority: Priority,
  })
  .openapi("PlannerTopic");

export const Student = z
  .object({
    id: Id,
    roll_no: z.string().openapi({ example: "CT-21001" }),
    name: z.string().openapi({ example: "Ahmed Khan" }),
  })
  .openapi("Student");

export const StudentWithAttendance = Student.extend({
  present: z.number().int(),
  absent: z.number().int(),
  attendance_percentage: Percentage,
  below_threshold: z.boolean(),
}).openapi("StudentWithAttendance");

export const Assessment = z
  .object({
    id: Id,
    type: ComponentType,
    title: z.string().openapi({ example: "Quiz 3" }),
    date: DateString.nullable(),
    total_marks: z.number().openapi({ example: 10 }),
    original_date: DateString.nullable().openapi({
      description: "Where the teacher first put it, if the planner had to move it",
    }),
    move_reason: z.string().nullable().openapi({
      example:
        "Quiz 3 moved from 19 Oct to 11 Nov because Normalization will not be completed before 4 Nov.",
    }),
  })
  .openapi("Assessment");

export const AssessmentListItem = Assessment.extend({
  marks_entered: z.number().int(),
  student_count: z.number().int(),
  topic_ids: z.array(z.number().int()),
}).openapi("AssessmentListItem");

export const Mark = z
  .object({
    student_id: Id,
    roll_no: z.string(),
    name: z.string(),
    obtained: z.number().nullable().openapi({
      description: "null means the teacher has not entered it yet. It is NOT a zero.",
    }),
    is_absent: z.boolean().openapi({
      description: "The student did not sit it. This IS a zero, and differs from obtained: null.",
    }),
  })
  .openapi("Mark");

export const GradeBand = z
  .object({
    grade: z.string().openapi({ example: "A-" }),
    min_percentage: z.number().openapi({ example: 80 }),
  })
  .openapi("GradeBand");

export const Material = z
  .object({
    id: Id,
    course_id: Id,
    topic_id: Id.nullable(),
    title: z.string().openapi({ example: "ER Modelling Slides" }),
    storage_path: z.string().openapi({
      example: "8/er-modelling-slides.pdf",
      description: "The path in Supabase Storage. The file itself never passes through this API.",
    }),
    mime_type: z.string().nullable(),
    size_bytes: z.number().nullable(),
    uploaded_at: z.string(),
  })
  .openapi("Material");

// ----------------------------------------------------------- planner output

export const AssessmentMove = z
  .object({
    assessment_id: z.number().int(),
    from: DateString,
    to: DateString,
    reason: z.string().openapi({
      example:
        "Quiz 3 moved from 19 Oct to 11 Nov because Normalization will not be completed before 4 Nov.",
      description: "Ready to show the teacher as-is. Do not rebuild this sentence in the app.",
    }),
  })
  .openapi("AssessmentMove");

export const SessionChange = z
  .object({
    kind: z.enum(["moved", "added", "removed"]),
    topic_id: z.number().int(),
    topic: z.string(),
    from: DateString.optional(),
    to: DateString.optional(),
  })
  .openapi({
    description: "One line for the 'what moved' screen. `moved` has both dates; `added` has only `to`; `removed` has only `from`.",
  })
  .openapi("SessionChange");

export const PlanGenerateResult = z
  .object({
    sessions: z.array(PlannedSession),
    overflow: z.array(PlannerTopic).openapi({
      description: "Topics there was no room for. A topic is never half-placed.",
    }),
    assessments_moved: z.array(AssessmentMove),
    slots_total: z.number().int(),
    slots_unused: z.number().int(),
    deficit: z.number().int().openapi({
      description: "sessions_needed - slots_available. Above zero means there is not enough time.",
    }),
  })
  .openapi("PlanGenerateResult");

export const ReplanResult = z
  .object({
    frozen: z.number().int().openapi({ description: "Conducted classes that were left untouched" }),
    sessions: z.array(PlannedSession),
    changes: z.array(SessionChange),
    assessments_moved: z.array(AssessmentMove),
    overflow: z.array(PlannerTopic),
    slots_available: z.number().int(),
    deficit: z.number().int(),
  })
  .openapi("ReplanResult");

export const DeficitOptions = z
  .object({
    deficit: z.number().int(),
    drop: z
      .object({
        type: z.literal("drop"),
        sessions_recovered: z.number().int(),
        covers_deficit: z.boolean(),
        topics: z.array(
          z.object({
            topic_id: z.number().int(),
            title: z.string(),
            sessions_freed: z.number().int(),
          }),
        ),
      })
      .openapi({ description: "Cut the lowest-priority topics" }),
    compress: z
      .object({
        type: z.literal("compress"),
        sessions_recovered: z.number().int(),
        covers_deficit: z.boolean(),
        topics: z.array(
          z.object({
            topic_id: z.number().int(),
            title: z.string(),
            from: z.number().int(),
            to: z.number().int(),
          }),
        ),
      })
      .openapi({ description: "Shorten topics that are above their min_sessions" }),
    extend: z
      .object({
        type: z.literal("extend"),
        sessions_recovered: z.number().int(),
        covers_deficit: z.boolean(),
        dates: z.array(DateString),
      })
      .openapi({ description: "Add makeup classes on days off" }),
    slots_available: z.number().int(),
    sessions_needed: z.number().int(),
  })
  .openapi({
    description:
      "`covers_deficit` is an honesty flag: an option may not fully solve the problem, and says so.",
  })
  .openapi("DeficitOptions");

export const ScheduleHealth = z
  .object({
    planned_up_to_today: z.number().int(),
    conducted: z.number().int(),
    cancelled: z.number().int(),
    behind_by_weeks: z.number().openapi({ example: 0.5 }),
    syllabus_percent: z.number().int(),
    total_sessions: z.number().int(),
  })
  .openapi("ScheduleHealth");

// ------------------------------------------------------------ grading output

export const ComponentResult = z
  .object({
    component: ComponentType,
    weight: z.number(),
    obtained: z.number(),
    out_of: z.number(),
    percentage: Percentage,
    contribution: z.number().openapi({ description: "This component's share of the final result" }),
    missing: z.array(z.object({ assessment_id: z.number().int(), title: z.string() })),
  })
  .openapi("ComponentResult");

export const StudentResult = z
  .object({
    student_id: z.number().int(),
    roll_no: z.string(),
    name: z.string(),
    components: z.array(ComponentResult),
    weighted_total: z.number().openapi({ example: 76 }),
    grade: z.string().openapi({ example: "B+" }),
    has_missing_marks: z.boolean().openapi({
      description: "True means the total is provisional. Show it as such.",
    }),
    missing_count: z.number().int(),
  })
  .openapi("StudentResult");

export const ResultSet = z
  .object({
    students: z.array(StudentResult),
    summary: z.object({
      student_count: z.number().int(),
      class_average: Percentage,
      highest: Percentage,
      lowest: Percentage,
      grade_distribution: z.record(z.string(), z.number().int()),
      pass_count: z.number().int(),
      fail_count: z.number().int(),
      students_with_missing_marks: z.number().int(),
    }),
    weightage: z.record(z.string(), z.number()),
    grade_scale: z.array(GradeBand),
  })
  .openapi("ResultSet");

export const AttendanceSummary = z
  .object({
    attendance_threshold: z.number(),
    classes_held: z.number().int(),
    class_average: Percentage,
    students: z.array(
      z.object({
        student_id: Id,
        roll_no: z.string(),
        name: z.string(),
        present: z.number().int(),
        absent: z.number().int(),
        leave: z.number().int(),
        classes_held: z.number().int(),
        percentage: Percentage,
      }),
    ),
    below_threshold: z.array(z.object({ student_id: Id, roll_no: z.string(), name: z.string(), percentage: Percentage })),
  })
  .openapi("AttendanceSummary");

export const Weightage = z
  .object({
    quiz: z.number(),
    assignment: z.number(),
    midterm: z.number(),
    final: z.number(),
    participation: z.number(),
    total: z.number().openapi({ description: "Convenience field for the screen. Not a component." }),
  })
  .openapi("Weightage");

export const ReportDocument = z
  .object({
    type: ReportType,
    title: z.string(),
    header: z.object({
      course_name: z.string(),
      course_code: z.string().nullable(),
      semester: z.string().nullable(),
      teacher_name: z.string().nullable(),
      department: z.string().nullable(),
      generated_on: DateString,
      signature_label: z.string(),
    }),
    columns: z.array(z.string()),
    rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
    summary: z.array(z.object({ label: z.string(), value: z.union([z.string(), z.number()]) })),
    notes: z.array(z.string()),
  })
  .openapi({
    description:
      "A fully computed report. `rows` lines up with `columns`. The PDF is a rendering of exactly this — nothing is calculated during rendering.",
  })
  .openapi("ReportDocument");

export const Dashboard = z
  .object({
    course: Course,
    today: DateString,
    schedule: ScheduleHealth.extend({
      warning: z.string().nullable().openapi({
        example: "You are 0.5 weeks behind your plan.",
        description: "Ready to show as-is. null when on schedule.",
      }),
    }),
    topics: z.object({
      total: z.number().int(),
      completed: z.number().int(),
      in_progress: z.number().int(),
      pending: z.number().int(),
      dropped: z.number().int(),
    }),
    next_session: Session.partial().nullable(),
    attendance: z.object({
      classes_held: z.number().int(),
      class_average: Percentage,
      student_count: z.number().int(),
      below_threshold_count: z.number().int(),
      below_threshold: z.array(
        z.object({ student_id: Id, roll_no: z.string(), name: z.string(), percentage: Percentage }),
      ),
    }),
    assessments: z.object({
      upcoming: z.array(Assessment),
      marks_outstanding: z.array(
        z.object({
          id: Id,
          type: ComponentType,
          title: z.string(),
          expected: z.number().int(),
          entered: z.number().int(),
        }),
      ),
    }),
    results: z
      .object({
        class_average: Percentage,
        highest: Percentage,
        lowest: Percentage,
        grade_distribution: z.record(z.string(), z.number().int()),
        pass_count: z.number().int(),
        fail_count: z.number().int(),
        students_with_missing_marks: z.number().int(),
      })
      .nullable()
      .openapi({ description: "null until the course has students" }),
    last_replan: z.object({ triggered_at: z.string(), reason: z.string() }).nullable(),
  })
  .openapi("Dashboard");

// ------------------------------------------------------- extraction (stubs)

export const ExtractedStudentRows = z
  .object({
    rows: z.array(
      z.object({
        roll_no: z.string().nullable(),
        name: z.string().nullable(),
        confidence: z.number().openapi({ description: "0-1. Highlight low values on the review screen." }),
      }),
    ),
    page_count: z.number().int(),
    source: z.string(),
    saved: z.literal(false).openapi({ description: "Always false. Nothing is written until /students/import." }),
    next_step: z.string(),
  })
  .openapi("ExtractedStudentRows");

export const ExtractedTopicRows = z
  .object({
    rows: z.array(
      z.object({
        title: z.string(),
        sessions_needed: z.number().int().nullable(),
        confidence: z.number(),
      }),
    ),
    page_count: z.number().int(),
    source: z.string(),
    saved: z.literal(false),
    next_step: z.string(),
  })
  .openapi("ExtractedTopicRows");
