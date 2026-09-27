/**
 * What each endpoint accepts: path parameters, query strings and request bodies.
 *
 * These are the schemas request validation runs against, so they must match what
 * the services actually accept. Where a service is lenient, the schema is
 * lenient — being stricter here would reject requests that work today.
 */

import { z } from "./zod.ts";
import {
  ClassDays,
  ComponentType,
  DateString,
  IdInput,
  Priority,
  ReportType,
  SessionStatus,
  TopicStatus,
} from "./schemas.ts";

// ------------------------------------------------------- path & query params

/** Path parameters arrive as strings, always. */
const pathId = (name: string) =>
  z.object({
    [name]: z.string().min(1).openapi({ param: { name, in: "path" }, example: "8" }),
  });

export const CourseIdParam = pathId("courseId");
export const IdParam = pathId("id");

export const CourseStudentParams = z.object({
  courseId: z.string().min(1).openapi({ param: { name: "courseId", in: "path" }, example: "8" }),
  studentId: z.string().min(1).openapi({ param: { name: "studentId", in: "path" }, example: "12" }),
});

export const ReportParams = z.object({
  courseId: z.string().min(1).openapi({ param: { name: "courseId", in: "path" }, example: "8" }),
  type: z
    .string()
    .min(1)
    .openapi({
      param: { name: "type", in: "path" },
      example: "result",
      description:
        "One of result, attendance, course. Add .pdf (result.pdf) for the PDF instead of JSON.",
    }),
});

/**
 * `today` overrides the server's idea of the current date.
 *
 * It exists so the whole semester can be demonstrated without waiting four
 * months, and so tests can pin a date. Leave it out in normal use.
 */
export const TodayQuery = z.object({
  today: DateString.optional().openapi({
    param: { name: "today", in: "query", required: false },
  }),
});

// ------------------------------------------------------------------- bodies

export const CreateCourseBody = z
  .object({
    name: z.string().min(1, "name is required").openapi({ example: "Database Systems" }),
    code: z.string().nullish().openapi({ example: "CS-301" }),
    semester: z.string().nullish().openapi({ example: "Fall 2026" }),
    start_date: DateString,
    end_date: DateString,
    class_days: ClassDays,
  })
  .openapi("CreateCourseBody");

export const UpdateCourseBody = z
  .object({
    name: z.string().min(1).optional(),
    code: z.string().nullish(),
    semester: z.string().nullish(),
    start_date: DateString.optional(),
    end_date: DateString.optional(),
    class_days: ClassDays.optional(),
    attendance_threshold: z.number().min(0).max(100).optional().openapi({ example: 80 }),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to update" })
  .openapi("UpdateCourseBody");

export const CloneCourseBody = z
  .object({
    name: z.string().min(1).optional(),
    semester: z.string().optional().openapi({ example: "Spring 2027" }),
    start_date: DateString.optional(),
    end_date: DateString.optional(),
  })
  .openapi("CloneCourseBody");

/**
 * Topics are one block of text, one per line — NOT an array.
 *
 * The server splits, trims and drops blank lines, so all three mobile
 * developers cannot each invent their own splitting rules. Sending an array is
 * not supported.
 */
export const CreateTopicsBody = z
  .object({
    raw: z.string().min(1, "raw is required").openapi({
      example:
        "Introduction to Database Systems\nThe Relational Model\nEntity Relationship Modelling\nSQL: Queries and Joins",
      description: "The whole textarea. One topic per line.",
    }),
  })
  .openapi("CreateTopicsBody");

export const UpdateTopicBody = z
  .object({
    title: z.string().min(1).optional(),
    sessions_needed: z.number().int().min(1).optional().openapi({ example: 3 }),
    min_sessions: z.number().int().min(1).optional().openapi({ example: 2 }),
    priority: Priority.optional(),
    status: TopicStatus.optional(),
    order_no: z.number().int().min(1).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: "Nothing to update" })
  .openapi("UpdateTopicBody");

export const ToggleHolidaysBody = z
  .object({
    holidays: z
      .array(z.object({ id: IdInput, is_active: z.boolean() }))
      .openapi({ example: [{ id: 3, is_active: false }] }),
  })
  .openapi("ToggleHolidaysBody");

export const StoragePathBody = z
  .object({
    storage_path: z.string().min(1, "storage_path is required").openapi({
      example: "8/class-list-page-1.jpg",
      description:
        "The path returned by Supabase Storage. Upload the file there first — it never passes through this API.",
    }),
  })
  .openapi("StoragePathBody");

export const ImportStudentsBody = z
  .object({
    students: z
      .array(
        z.object({
          roll_no: z.string().min(1).openapi({ example: "CT-21001" }),
          name: z.string().min(1).openapi({ example: "Ahmed Khan" }),
        }),
      )
      .min(1, "students must be a non-empty array"),
  })
  .openapi({
    description:
      "The list AFTER the teacher has reviewed and confirmed it. Never post extraction output straight here.",
  })
  .openapi("ImportStudentsBody");

export const GeneratePlanBody = z
  .object({
    reset: z.boolean().optional().openapi({
      description:
        "Start the plan completely over, DELETING conducted classes and their attendance. Only when the teacher has explicitly asked for that.",
    }),
  })
  .openapi("GeneratePlanBody");

export const ReplanBody = z
  .object({
    today: DateString.optional(),
    reason: z.string().optional().openapi({ example: "2 classes were cancelled during the semester" }),
  })
  .openapi("ReplanBody");

export const ApplyDeficitBody = z
  .object({
    option: z.enum(["drop", "compress", "extend"]),
    today: DateString.optional(),
  })
  .openapi("ApplyDeficitBody");

export const UpdateSessionBody = z
  .object({
    status: SessionStatus,
    cancel_reason: z.string().min(1).optional().openapi({
      example: "University closed at short notice",
      description: "Required when status is cancelled. The course report prints it.",
    }),
  })
  .refine((body) => body.status !== "cancelled" || (body.cancel_reason ?? "").trim() !== "", {
    message: "cancel_reason is required when cancelling a class",
  })
  .openapi("UpdateSessionBody");

export const SubmitAttendanceBody = z
  .object({
    absent: z.array(IdInput).optional().openapi({ example: [12, 40, 41] }),
    leave: z.array(IdInput).optional().openapi({ example: [7] }),
  })
  .openapi({
    description:
      "Send ONLY the absentees. Every other enrolled student is marked present. Submitting again overwrites.",
  })
  .openapi("SubmitAttendanceBody");

export const CreateAssessmentBody = z
  .object({
    type: ComponentType,
    title: z.string().min(1).openapi({ example: "Quiz 3" }),
    total_marks: z.number().positive().openapi({ example: 10 }),
    date: DateString.nullish(),
    topic_ids: z.array(IdInput).optional().openapi({
      example: [7, 8],
      description:
        "Which topics this covers. The planner uses these to refuse scheduling it before they are taught.",
    }),
  })
  .openapi("CreateAssessmentBody");

export const SaveMarksBody = z
  .object({
    marks: z
      .array(
        z.object({
          student_id: IdInput,
          obtained: z.union([z.number(), z.string(), z.null()]).optional().openapi({
            example: 7.5,
            description: "Omit, or send null, to clear the mark back to not-entered.",
          }),
          is_absent: z.boolean().optional().openapi({
            description: "The student did not sit it. Counts as a real zero.",
          }),
        }),
      )
      .min(1, "marks must be a non-empty array"),
  })
  .openapi("SaveMarksBody");

export const SetWeightageBody = z
  .object({
    quiz: z.number().min(0).max(100).optional(),
    assignment: z.number().min(0).max(100).optional(),
    midterm: z.number().min(0).max(100).optional(),
    final: z.number().min(0).max(100).optional(),
    participation: z.number().min(0).max(100).optional(),
  })
  .openapi({
    description:
      "Must total 100 (a tolerance of 0.01 allows 33.33 + 33.33 + 33.34). Anything left out counts as 0.",
  })
  .openapi("SetWeightageBody");

export const SetGradeScaleBody = z
  .object({
    bands: z
      .array(
        z.object({
          grade: z.string().min(1).openapi({ example: "A" }),
          min_percentage: z.number().min(0).max(100).openapi({ example: 85 }),
        }),
      )
      .min(1),
  })
  .openapi({
    description:
      "Replaces the whole scale. The lowest band must start at 0 so every mark gets a grade, and no letter may repeat.",
  })
  .openapi("SetGradeScaleBody");

export const CreateMaterialBody = z
  .object({
    title: z.string().min(1).openapi({ example: "ER Modelling Slides" }),
    storage_path: z.string().min(1).openapi({ example: "8/er-modelling-slides.pdf" }),
    topic_id: IdInput.nullish(),
    mime_type: z.string().nullish().openapi({ example: "application/pdf" }),
    size_bytes: z.number().nonnegative().nullish().openapi({ example: 2400000 }),
  })
  .openapi("CreateMaterialBody");
