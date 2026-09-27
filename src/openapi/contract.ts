/**
 * THE API CONTRACT. Every endpoint, in one list.
 *
 * This is the single definition the whole project reads:
 *
 *   src/openapi/document.ts   -> turns it into the OpenAPI spec and Swagger UI
 *   src/middleware/validate.ts -> validates incoming requests against it
 *   tests/contract.test.ts     -> checks it matches the routers that are mounted
 *
 * So the docs cannot drift from the code, because there is no second place to
 * update. Adding an endpoint means adding a row here and a route handler.
 *
 * !! Endpoint names and field names are FROZEN once published. Three mobile
 * developers build against this. A rename that costs two minutes here costs the
 * team an afternoon.
 */

import { z } from "./zod.ts";
import * as S from "./schemas.ts";
import * as R from "./requests.ts";

export type HttpMethod = "get" | "post" | "patch" | "put" | "delete";

export type EndpointDef = {
  method: HttpMethod;
  /** OpenAPI style, with braces: /courses/{courseId}/topics */
  path: string;
  tag: string;
  summary: string;
  description?: string;
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
  /** The schema of the `data` field in the success envelope. */
  response: z.ZodType;
  /** The success status code. 200 unless stated. */
  status?: number;
  /** Error codes worth documenting beyond the ones every endpoint can return. */
  errors?: number[];
  /** True for the two endpoints that need no token. */
  isPublic?: boolean;
  /** True when the response is not the JSON envelope (the PDF). */
  raw?: boolean;
};

/** Shorthand for an endpoint returning an array. */
const list = (item: z.ZodType) => z.array(item);

export const CONTRACT: EndpointDef[] = [
  // ------------------------------------------------------------- health
  {
    method: "get",
    path: "/health",
    tag: "Health",
    summary: "Is the server up",
    description:
      "Deliberately touches no database, so a database problem cannot make the server look dead. Needs no token.",
    response: z.object({ status: z.literal("ok") }),
    isPublic: true,
  },

  // --------------------------------------------------------------- auth
  {
    method: "get",
    path: "/auth/me",
    tag: "Auth",
    summary: "The signed-in teacher",
    description:
      "Sign-in itself happens in the app, against Supabase. This verifies the token and returns the profile, creating the teacher row on the first call. Call it straight after sign-in.",
    response: S.Teacher,
  },

  // ------------------------------------------------------------ courses
  {
    method: "post",
    path: "/courses",
    tag: "Courses",
    summary: "Create a course",
    description:
      "The minimum to get started: name, dates and class days. Public holidays for the date range are preloaded automatically in the same transaction. Students, weightage and the grade scale are asked for later, by the features that need them.",
    body: R.CreateCourseBody,
    response: S.Course,
    status: 201,
  },
  {
    method: "get",
    path: "/courses",
    tag: "Courses",
    summary: "List the teacher's courses",
    description: "Includes counts and a has_plan flag, so the list screen needs no extra requests.",
    response: list(S.CourseListItem),
  },
  {
    method: "get",
    path: "/courses/{courseId}",
    tag: "Courses",
    summary: "One course, with its topics and holidays",
    description: "Everything the setup screen needs in one request.",
    params: R.CourseIdParam,
    response: S.CourseDetail,
  },
  {
    method: "patch",
    path: "/courses/{courseId}",
    tag: "Courses",
    summary: "Edit course settings",
    description:
      "Only the fields you send are changed. Changing the dates or class days invalidates the timetable, so the response carries replan_required — show the teacher a 'rebuild your plan' prompt when it is true. Extending the semester also tops up any newly exposed public holidays, leaving the teacher's existing ticks alone.",
    params: R.CourseIdParam,
    body: R.UpdateCourseBody,
    response: S.Course.extend({ replan_required: z.boolean() }),
  },
  {
    method: "post",
    path: "/courses/{courseId}/clone",
    tag: "Courses",
    summary: "Start next semester from this course",
    description:
      "Copies the teacher's preparation: topics (reset to pending), weightage and grade scale. Does NOT copy students, sessions, attendance or marks — those belong to the semester that ended. Public holidays are recalculated for the new dates rather than copied, because Eid moves every year.",
    params: R.CourseIdParam,
    body: R.CloneCourseBody,
    response: S.Course.extend({
      copied: z.object({ topics: z.number().int(), holidays: z.number().int() }),
    }),
    status: 201,
  },

  // ------------------------------------------------------------- topics
  {
    method: "post",
    path: "/courses/{courseId}/topics",
    tag: "Topics",
    summary: "Set the course topics from one block of text",
    description:
      "Send the whole textarea as `raw`, one topic per line. The server splits, trims and drops blank lines. Only the title is needed — sessions_needed and min_sessions default to 1 and priority to normal, and the teacher corrects them after seeing the generated plan. NOTE: this REPLACES all topics for the course.",
    params: R.CourseIdParam,
    body: R.CreateTopicsBody,
    response: list(S.Topic),
  },
  {
    method: "patch",
    path: "/topics/{id}",
    tag: "Topics",
    summary: "Edit one topic",
    description:
      "How the teacher corrects a topic after seeing the plan. Changing sessions_needed, order_no or status invalidates the timetable, so check replan_required in the response.",
    params: R.IdParam,
    body: R.UpdateTopicBody,
    response: S.Topic.extend({ course_id: z.number().int(), replan_required: z.boolean() }),
  },

  // ----------------------------------------------------------- holidays
  {
    method: "get",
    path: "/courses/{courseId}/holidays",
    tag: "Holidays",
    summary: "The preloaded holidays and their on/off state",
    params: R.CourseIdParam,
    response: list(S.Holiday),
  },
  {
    method: "post",
    path: "/courses/{courseId}/holidays",
    tag: "Holidays",
    summary: "Tick or untick holidays",
    description:
      "The teacher unticks what does not apply rather than typing dates. Only active holidays are removed from the timetable. Send the ones that changed.",
    params: R.CourseIdParam,
    body: R.ToggleHolidaysBody,
    response: list(S.Holiday),
  },

  // ------------------------------------------------------------ planner
  {
    method: "post",
    path: "/courses/{courseId}/plan/generate",
    tag: "Planner",
    summary: "Build the whole timetable",
    description:
      "The BEFORE-the-semester path. Lays every topic across every available date from the start date. Also checks each assessment is not scheduled before its topics are taught, moving any that are and explaining why.\n\nReturns 400 once any class has been conducted — mid-semester the correct endpoint is /plan/replan, which freezes the past. Send { reset: true } only if the teacher explicitly wants to start over, which deletes conducted classes and their attendance.",
    params: R.CourseIdParam,
    body: R.GeneratePlanBody,
    response: S.PlanGenerateResult,
    status: 201,
    errors: [400],
  },
  {
    method: "post",
    path: "/courses/{courseId}/plan/replan",
    tag: "Planner",
    summary: "Rebuild the future after a disruption",
    description:
      "Freeze the past, rebuild the future. Classes marked conducted are never touched; dates from today onward are worked out again; only teaching that has not happened yet is re-allocated. Use this after a cancellation or a change to a topic's sessions_needed.\n\n`changes` is what the 'what moved' screen shows — the response reports what changed, not just the new plan.",
    params: R.CourseIdParam,
    body: R.ReplanBody,
    response: S.ReplanResult,
  },
  {
    method: "get",
    path: "/courses/{courseId}/plan/deficit",
    tag: "Planner",
    summary: "The three ways out of a shortage",
    description:
      "When there is not enough time left this does NOT error — it computes three resolutions (drop, compress, extend) and lets the teacher choose. Each carries covers_deficit, which is false when that option cannot fully solve the problem.",
    params: R.CourseIdParam,
    query: R.TodayQuery,
    response: S.DeficitOptions,
  },
  {
    method: "post",
    path: "/courses/{courseId}/plan/deficit/apply",
    tag: "Planner",
    summary: "Apply the teacher's chosen option",
    description:
      "Applies the choice — dropping topics, shortening them, or recording makeup dates — and then replans. The response is the replan result, so the 'what moved' screen can be shown straight afterwards.",
    params: R.CourseIdParam,
    body: R.ApplyDeficitBody,
    response: S.ReplanResult,
  },

  // ----------------------------------------------------------- sessions
  {
    method: "get",
    path: "/courses/{courseId}/sessions",
    tag: "Sessions",
    summary: "The saved plan, flat and grouped by week",
    description:
      "Returns the same classes twice: `sessions` in date order, and `weeks` already grouped, so every screen that draws a week view does not repeat the grouping. topic_title is included, so no second request is needed to name topics.",
    params: R.CourseIdParam,
    response: z.object({
      sessions: list(S.Session),
      weeks: list(z.object({ week_no: z.number().int(), sessions: list(S.Session) })),
    }),
  },
  {
    method: "patch",
    path: "/sessions/{id}",
    tag: "Sessions",
    summary: "Mark a class conducted or cancelled",
    description:
      "cancel_reason is required when cancelling, because the course report prints why each class was cancelled. Marking a class conducted recalculates its topic's status.",
    params: R.IdParam,
    body: R.UpdateSessionBody,
    response: S.Session,
  },

  // --------------------------------------------------------- attendance
  {
    method: "post",
    path: "/sessions/{id}/attendance",
    tag: "Attendance",
    summary: "Submit attendance (absentees only)",
    description:
      "Send only the absentees — everyone else enrolled is marked present. For a class of 42 that is three or four ids instead of 42. Submitting again overwrites, so the teacher can fix a mistake. This also marks the class conducted, because taking the roll means the class happened.",
    params: R.IdParam,
    body: R.SubmitAttendanceBody,
    response: z.object({
      session_id: z.number().int(),
      marked: z.number().int(),
      present: z.number().int(),
      absent: z.number().int(),
      leave: z.number().int(),
    }),
    status: 201,
  },
  {
    method: "get",
    path: "/sessions/{id}/attendance",
    tag: "Attendance",
    summary: "What is already recorded, for the edit screen",
    description:
      "Every enrolled student, defaulting to present where nothing was recorded. `recorded` tells you whether a row actually exists.",
    params: R.IdParam,
    response: list(
      z.object({
        student_id: S.Id,
        roll_no: z.string(),
        name: z.string(),
        status: S.AttendanceStatus,
        recorded: z.boolean(),
      }),
    ),
  },
  {
    method: "get",
    path: "/courses/{courseId}/attendance/summary",
    tag: "Attendance",
    summary: "Percentages and the below-threshold list",
    description:
      "Only conducted classes count in the denominator — a cancelled class was never an opportunity to attend, so counting it would penalise students for the teacher's cancellation. A 'leave' record is excused: removed from the denominator rather than counted as an absence. percentage is null before any class has happened.",
    params: R.CourseIdParam,
    response: S.AttendanceSummary,
  },

  // ----------------------------------------------------------- students
  {
    method: "post",
    path: "/courses/{courseId}/students/extract",
    tag: "Students",
    summary: "Read a class-list photo or PDF (nothing is saved)",
    description:
      "Upload the photo to Supabase Storage first and send the path. Returns a DRAFT for the review screen and writes nothing — saved is always false.\n\nThe review screen is mandatory. Printed roll numbers misread easily (CT-21001 vs CT-2100I) and a wrong one silently corrupts that student's attendance and result for the whole semester. Once the teacher has fixed it, post the confirmed rows to /students/import.\n\nCurrently returns 503: the extraction tool is not chosen yet. Use the manual entry path on the review screen meanwhile.",
    params: R.CourseIdParam,
    body: R.StoragePathBody,
    response: S.ExtractedStudentRows,
    errors: [503],
  },
  {
    method: "post",
    path: "/courses/{courseId}/students/import",
    tag: "Students",
    summary: "Save the reviewed, confirmed class list",
    description:
      "Rejects rows with a missing roll number or name, and rejects duplicate roll numbers rather than merging them — a duplicate means one was misread, and merging would lose a student. Re-importing is safe: an existing roll number is matched and its name refreshed.",
    params: R.CourseIdParam,
    body: R.ImportStudentsBody,
    response: z.object({
      students: list(S.Student),
      saved: z.number().int(),
      newly_enrolled: z.number().int(),
    }),
    status: 201,
    errors: [400],
  },
  {
    method: "post",
    path: "/courses/{courseId}/outline/import",
    tag: "Topics",
    summary: "Read a course outline file into topics for review",
    description:
      "Same two-step shape as the class list: this returns extracted topics and saves nothing. Show them for review, then post the confirmed titles to /courses/{courseId}/topics.\n\nCurrently returns 503: the extraction tool is not chosen yet.",
    params: R.CourseIdParam,
    body: R.StoragePathBody,
    response: S.ExtractedTopicRows,
    errors: [503],
  },
  {
    method: "get",
    path: "/courses/{courseId}/students",
    tag: "Students",
    summary: "The class list with attendance percentages",
    params: R.CourseIdParam,
    response: list(S.StudentWithAttendance),
  },
  {
    method: "delete",
    path: "/courses/{courseId}/students/{studentId}",
    tag: "Students",
    summary: "Remove a student from this course",
    description:
      "Removes the enrollment only. The student record is kept, because the same person may be in the teacher's other courses.",
    params: R.CourseStudentParams,
    response: z.object({ removed: z.number().int() }),
  },
  {
    method: "get",
    path: "/students/{id}",
    tag: "Students",
    summary: "One student: attendance record and every mark",
    description:
      "A student belongs to the teacher rather than to one course, so this covers every course of theirs the student is enrolled in.",
    params: R.IdParam,
    response: S.Student.extend({
      attendance: list(
        z.object({
          course_id: S.Id,
          course_name: z.string(),
          date: S.DateString,
          topic_title: z.string().nullable(),
          status: S.AttendanceStatus,
        }),
      ),
      marks: list(
        z.object({
          course_id: S.Id,
          course_name: z.string(),
          assessment_id: S.Id,
          type: S.ComponentType,
          title: z.string(),
          total_marks: z.number(),
          obtained: z.number().nullable(),
          is_absent: z.boolean(),
        }),
      ),
    }),
  },

  // -------------------------------------------------------- assessments
  {
    method: "post",
    path: "/courses/{courseId}/assessments",
    tag: "Assessments",
    summary: "Create a quiz, assignment, midterm or final",
    description:
      "A quiz is marked as a single total — there is no per-question marking, because for 70 students and 10 questions that would be 700 numbers to type.\n\nSend topic_ids so the planner can refuse to schedule it before those topics are taught.",
    params: R.CourseIdParam,
    body: R.CreateAssessmentBody,
    response: S.Assessment,
    status: 201,
  },
  {
    method: "get",
    path: "/courses/{courseId}/assessments",
    tag: "Assessments",
    summary: "List them, with how many marks are in",
    description: "marks_entered against student_count tells you which still need work.",
    params: R.CourseIdParam,
    response: list(S.AssessmentListItem),
  },
  {
    method: "get",
    path: "/assessments/{id}/marks",
    tag: "Marks",
    summary: "The whole class, ready for the entry screen",
    description:
      "EVERY enrolled student in roll-number order, including those with no mark yet — otherwise the teacher could not enter one. obtained is null for those, and null means not entered, never zero.",
    params: R.IdParam,
    response: z.object({
      assessment: z.object({
        id: S.Id,
        type: S.ComponentType,
        title: z.string(),
        date: S.DateString.nullable(),
        total_marks: z.number(),
      }),
      marks: list(S.Mark),
    }),
  },
  {
    method: "post",
    path: "/assessments/{id}/marks",
    tag: "Marks",
    summary: "Save the marks entered so far",
    description:
      "Send whatever the teacher has filled in; sending it again overwrites. A mark above total_marks is rejected — that is a slipped keypad. Omitting obtained, or sending null, clears it back to not-entered. A student not enrolled in the course is silently ignored and counted in `ignored`.",
    params: R.IdParam,
    body: R.SaveMarksBody,
    response: z.object({
      saved: z.number().int(),
      ignored: z.number().int(),
      marks: list(z.object({ student_id: S.Id, obtained: z.number().nullable(), is_absent: z.boolean() })),
    }),
    status: 201,
    errors: [400],
  },

  // ------------------------------------------------------------ grading
  {
    method: "get",
    path: "/courses/{courseId}/results",
    tag: "Grading",
    summary: "Weighted totals and letter grades",
    description:
      "The SAME computation that feeds the result PDF, so the screen and the document can never disagree.\n\nThree rules worth knowing when you display this: the total is rounded once at the end, not per component; a mark that was never entered is left out of the sum entirely and flagged in has_missing_marks rather than treated as zero; and an absent student scores a real zero. Show a total with has_missing_marks as provisional.",
    params: R.CourseIdParam,
    response: S.ResultSet,
  },
  {
    method: "get",
    path: "/courses/{courseId}/weightage",
    tag: "Grading",
    summary: "The component percentages",
    description:
      "Seeded with a sensible default the first time it is asked for, so the teacher opens the screen already filled in rather than facing an empty form at setup time.",
    params: R.CourseIdParam,
    response: S.Weightage,
  },
  {
    method: "put",
    path: "/courses/{courseId}/weightage",
    tag: "Grading",
    summary: "Edit the component percentages",
    description: "Must total 100. Anything left out counts as 0.",
    params: R.CourseIdParam,
    body: R.SetWeightageBody,
    response: S.Weightage,
    errors: [400],
  },
  {
    method: "get",
    path: "/courses/{courseId}/grade-scale",
    tag: "Grading",
    summary: "The course grade scale",
    description:
      "Seeded with a default the teacher can edit. Grading scales differ between universities, so this is never hardcoded in the app.",
    params: R.CourseIdParam,
    response: list(S.GradeBand),
  },
  {
    method: "put",
    path: "/courses/{courseId}/grade-scale",
    tag: "Grading",
    summary: "Replace the grade scale",
    description:
      "The lowest band must start at 0, so every mark gets a grade, and no letter may repeat. Bands are stored highest-first regardless of the order you send them.",
    params: R.CourseIdParam,
    body: R.SetGradeScaleBody,
    response: list(S.GradeBand),
    errors: [400],
  },

    // ----------------------------------------------------------- material
  {
    method: "post",
    path: "/courses/{courseId}/materials",
    tag: "Material",
    summary: "Save a material record after uploading to Supabase",
    description:
      "Upload the file directly to Supabase Storage and send the returned path. The file never passes through this API in either direction.",
    params: R.CourseIdParam,
    body: R.CreateMaterialBody,
    response: S.Material,
    status: 201,
  },
  {
    method: "get",
    path: "/courses/{courseId}/materials",
    tag: "Material",
    summary: "The saved records, flat and grouped into folders",
    description: "Files with no topic are grouped under 'Unsorted' at the end.",
    params: R.CourseIdParam,
    response: z.object({
      materials: list(S.Material.extend({ topic_title: z.string().nullable() })),
      folders: list(
        z.object({
          topic_title: z.string(),
          topic_id: S.Id.nullable(),
          count: z.number().int(),
          materials: list(S.Material.extend({ topic_title: z.string().nullable() })),
        }),
      ),
    }),
  },
  {
    method: "delete",
    path: "/materials/{id}",
    tag: "Material",
    summary: "Remove a material record",
    description:
      "Deletes our record and returns its storage_path, so the app can then delete the stored file itself. This API does not delete it.",
    params: R.IdParam,
    response: z.object({ id: S.Id, storage_path: z.string() }),
  },

  // -------------------------------------------------- dashboard & reports
  {
    method: "get",
    path: "/courses/{courseId}/dashboard",
    tag: "Dashboard",
    summary: "Every dashboard number in one response",
    description:
      "One request for the whole screen. schedule.warning is a ready-made sentence — show it as-is, and it is null when the teacher is on schedule. assessments.marks_outstanding lists exactly which assessments still need marks.",
    params: R.CourseIdParam,
    query: R.TodayQuery,
    response: S.Dashboard,
  },
  {
    method: "get",
    path: "/courses/{courseId}/reports/{type}",
    tag: "Reports",
    summary: "A finished report, as JSON or PDF",
    description:
      "`type` is result, attendance or course. Ask for `result` and you get the fully computed report as JSON — every number, row, summary line and footnote — which is what the preview screen shows. Ask for `result.pdf` and you get the PDF of exactly that data.\n\nThe JSON form works today. The .pdf form returns 503 until the PDF tool is chosen.",
    params: R.ReportParams,
    query: R.TodayQuery,
    response: S.ReportDocument,
    errors: [400, 503],
  },
];

/** Look an endpoint up by method and OpenAPI path. */
export const findEndpoint = (method: HttpMethod, path: string): EndpointDef | undefined =>
  CONTRACT.find((e) => e.method === method && e.path === path);
