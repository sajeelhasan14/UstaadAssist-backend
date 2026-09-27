/**
 * Seed a realistic full-semester demo course — Milestone 8.
 *
 * Run it with:
 *   node --experimental-strip-types --env-file=.env scripts/seed.ts
 *   node --experimental-strip-types --env-file=.env scripts/seed.ts <teacher-uuid>
 *
 * With no argument it uses the first user in Supabase auth.users, which for a
 * fresh project is you.
 *
 * Two things worth knowing about this file:
 *
 *   * It goes through the real services, not straight into SQL. So running it is
 *     also an end-to-end test: if the planner, the attendance rules or the grade
 *     computation were broken, this script would fail or print wrong numbers.
 *
 *   * It is the ONLY place in the repo allowed to contain invented data.
 *     CLAUDE.md: "No mock or placeholder data in application code. Seed data
 *     goes in a seed script."
 *
 * It is safe to run twice. It deletes any course it previously created for this
 * teacher with the same code before building a new one.
 */

import { pool, transaction } from "../src/db/pool.ts";
import { holidaysBetween } from "../src/data/pakHolidays.ts";
import { generatePlan, replanCourse, getDeficitOptions } from "../src/services/plan.service.ts";
import { importStudents } from "../src/services/student.service.ts";
import { submitAttendance } from "../src/services/attendance.service.ts";
import { updateSession } from "../src/services/session.service.ts";
import {
  createAssessment,
  saveMarks,
  getResults,
  getWeightage,
  getGradeScale,
} from "../src/services/grading.service.ts";
import { getDashboard } from "../src/services/dashboard.service.ts";

// ----------------------------------------------------------- the demo data

const COURSE = {
  name: "Database Systems",
  code: "CS-301",
  semester: "Fall 2026",
  start_date: "2026-09-01",
  end_date: "2026-12-18",
  class_days: ["mon", "wed"],
};

/**
 * A real Database Systems syllabus. `sessions_needed` is deliberately uneven,
 * because that is what makes the planner interesting: 14 topics needing 30
 * classes against roughly 30 available slots, so small disruptions bite.
 */
const TOPICS = [
  { title: "Introduction to Database Systems", sessions: 1, min: 1, priority: "normal" },
  { title: "The Relational Model", sessions: 2, min: 1, priority: "high" },
  { title: "Entity Relationship Modelling", sessions: 3, min: 2, priority: "high" },
  { title: "Relational Algebra", sessions: 2, min: 1, priority: "normal" },
  { title: "SQL: Queries and Joins", sessions: 4, min: 3, priority: "high" },
  { title: "SQL: Views, Constraints and Triggers", sessions: 2, min: 1, priority: "normal" },
  { title: "Functional Dependencies", sessions: 2, min: 1, priority: "high" },
  { title: "Normalization", sessions: 3, min: 2, priority: "high" },
  { title: "File Organisation and Indexing", sessions: 3, min: 2, priority: "normal" },
  { title: "Query Processing and Optimisation", sessions: 2, min: 1, priority: "normal" },
  { title: "Transactions and ACID Properties", sessions: 2, min: 2, priority: "high" },
  { title: "Concurrency Control", sessions: 2, min: 1, priority: "normal" },
  { title: "Recovery and Backup", sessions: 1, min: 1, priority: "low" },
  { title: "NoSQL and Distributed Databases", sessions: 1, min: 1, priority: "low" },
];

const FIRST_NAMES = [
  "Ahmed", "Ali", "Ayesha", "Bilal", "Fatima", "Hamza", "Hira", "Hassan",
  "Iqra", "Junaid", "Kashif", "Laiba", "Maryam", "Mubashir", "Nimra", "Omar",
  "Rabia", "Saad", "Sana", "Talha", "Umar", "Usman", "Zainab", "Zohaib",
  "Areeba", "Danish", "Eman", "Faizan", "Ghazal", "Haris", "Komal", "Moiz",
  "Noor", "Rehan", "Sadia", "Shoaib", "Tayyaba", "Waleed", "Yusra", "Zeeshan",
];

const LAST_NAMES = [
  "Khan", "Ahmed", "Malik", "Hussain", "Sheikh", "Butt", "Raza", "Qureshi",
  "Siddiqui", "Farooq", "Javed", "Nawaz", "Iqbal", "Rashid", "Saleem", "Tariq",
];

const ASSESSMENTS = [
  { type: "quiz", title: "Quiz 1", date: "2026-09-21", total: 10, topics: [1, 2] },
  { type: "quiz", title: "Quiz 2", date: "2026-10-05", total: 10, topics: [3, 4] },
  // Deliberately too early: Normalization will not be finished by 19 Oct, so the
  // planner must move this one and say why. This is the Section 3.3 demo.
  { type: "quiz", title: "Quiz 3", date: "2026-10-19", total: 10, topics: [7, 8] },
  { type: "assignment", title: "ER Diagram Assignment", date: "2026-09-30", total: 20, topics: [3] },
  { type: "assignment", title: "SQL Assignment", date: "2026-10-14", total: 20, topics: [5, 6] },
  { type: "midterm", title: "Midterm Examination", date: "2026-10-26", total: 50, topics: [1, 2, 3, 4, 5] },
  { type: "quiz", title: "Quiz 4", date: "2026-11-23", total: 10, topics: [11, 12] },
  { type: "final", title: "Final Examination", date: "2026-12-18", total: 100, topics: [] },
];

// ------------------------------------------------------------------ helpers

/** Deterministic pseudo-random, so every run produces the same demo. */
function makeRandom(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

const random = makeRandom(20260927);

function pick<T>(list: T[]): T {
  return list[Math.floor(random() * list.length)]!;
}

function buildStudents(count: number) {
  const students: { roll_no: string; name: string }[] = [];
  const used = new Set<string>();

  for (let i = 1; i <= count; i++) {
    let name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
    while (used.has(name)) name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
    used.add(name);

    students.push({
      roll_no: `CT-21${String(i).padStart(3, "0")}`,
      name,
    });
  }

  return students;
}

function log(step: string, detail: string) {
  console.log(`  ${step.padEnd(28)} ${detail}`);
}

// --------------------------------------------------------------- the script

async function main() {
  const wanted = process.argv[2];

  const teacherRow = wanted
    ? await pool.query(`select id, email from auth.users where id = $1`, [wanted])
    : await pool.query(`select id, email from auth.users order by created_at limit 1`);

  const authUser = teacherRow.rows[0];

  if (!authUser) {
    console.error(
      "No user found in auth.users.\n\n" +
        "Sign in through the app once (or create a user in the Supabase dashboard),\n" +
        "then run this script again.",
    );
    process.exit(1);
  }

  const teacherId: string = authUser.id;
  console.log(`\nSeeding a demo course for ${authUser.email}\n`);

  // 1. The teacher row -----------------------------------------------------
  await pool.query(
    `insert into teacher (id, email, full_name, department)
     values ($1, $2, $3, $4)
     on conflict (id) do update
        set full_name  = coalesce(teacher.full_name, excluded.full_name),
            department = coalesce(teacher.department, excluded.department)`,
    [teacherId, authUser.email, "Dr. Sajeel Hasan", "Computer Science"],
  );
  log("teacher", authUser.email);

  // 2. A clean slate -------------------------------------------------------
  const removed = await pool.query(
    `delete from course where teacher_id = $1 and code = $2 returning id`,
    [teacherId, COURSE.code],
  );
  if (removed.rowCount) log("removed old demo course", `${removed.rowCount} course(s)`);

  // 3. The course, its topics and its holidays -----------------------------
  const courseId = await transaction(async (client) => {
    const created = await client.query(
      `insert into course (teacher_id, name, code, semester, start_date, end_date, class_days)
       values ($1, $2, $3, $4, $5, $6, $7)
       returning id`,
      [
        teacherId,
        COURSE.name,
        COURSE.code,
        COURSE.semester,
        COURSE.start_date,
        COURSE.end_date,
        COURSE.class_days,
      ],
    );

    const id: string = created.rows[0].id;

    await client.query(
      `insert into topic (course_id, order_no, title, sessions_needed, min_sessions, priority)
       select $1, t.order_no, t.title, t.sessions, t.min, t.priority
         from unnest($2::int[], $3::text[], $4::int[], $5::int[], $6::text[])
           as t(order_no, title, sessions, min, priority)`,
      [
        id,
        TOPICS.map((_, i) => i + 1),
        TOPICS.map((t) => t.title),
        TOPICS.map((t) => t.sessions),
        TOPICS.map((t) => t.min),
        TOPICS.map((t) => t.priority),
      ],
    );

    const holidays = holidaysBetween(COURSE.start_date, COURSE.end_date);
    if (holidays.length > 0) {
      await client.query(
        `insert into holiday (course_id, date, name)
         select $1, h.date, h.name from unnest($2::date[], $3::text[]) as h(date, name)
         on conflict (course_id, date) do nothing`,
        [id, holidays.map((h) => h.date), holidays.map((h) => h.name)],
      );
    }

    return id;
  });

  log("course", `${COURSE.code} ${COURSE.name} (id ${courseId})`);
  log("topics", `${TOPICS.length}, needing ${TOPICS.reduce((n, t) => n + t.sessions, 0)} classes`);

  const holidayCount = await pool.query(
    `select count(*)::int as n from holiday where course_id = $1`,
    [courseId],
  );
  log("holidays preloaded", `${holidayCount.rows[0].n}`);

  // 4. The class list ------------------------------------------------------
  const students = buildStudents(42);
  const imported = await importStudents(courseId, teacherId, { students });
  log("students enrolled", `${imported.newly_enrolled}`);

  const enrolled = await pool.query(
    `select s.id, s.roll_no from enrollment e join student s on s.id = e.student_id
      where e.course_id = $1 order by s.roll_no`,
    [courseId],
  );
  const studentIds: number[] = enrolled.rows.map((r) => Number(r.id));

  // 5. The assessments -----------------------------------------------------
  const topicRows = await pool.query(
    `select id, order_no from topic where course_id = $1 order by order_no`,
    [courseId],
  );
  const topicIdByOrder = new Map<number, number>(
    topicRows.rows.map((r) => [r.order_no, Number(r.id)]),
  );

  const assessmentIds: { id: number; title: string; total: number; type: string }[] = [];

  for (const a of ASSESSMENTS) {
    const created = await createAssessment(courseId, teacherId, {
      type: a.type,
      title: a.title,
      date: a.date,
      total_marks: a.total,
      topic_ids: a.topics.map((order) => topicIdByOrder.get(order)).filter(Boolean),
    });
    assessmentIds.push({
      id: Number(created.id),
      title: a.title,
      total: a.total,
      type: a.type,
    });
  }
  log("assessments", `${assessmentIds.length}`);

  // 6. Generate the plan ---------------------------------------------------
  const plan = await generatePlan(courseId, teacherId);
  log("plan generated", `${plan.sessions.length} classes over ${plan.slots_total} slots`);

  if (plan.overflow.length > 0) {
    log("overflow", `${plan.overflow.length} topic(s) did not fit`);
  }
  for (const move of plan.assessments_moved) {
    console.log(`\n    MOVED: ${move.reason}\n`);
  }

  // 7. Run the semester as far as "today" ----------------------------------
  //
  // The demo pretends it is 18 November: about three quarters of the way in, with
  // real disruption behind it. That is the state worth demonstrating, because the
  // dashboard, the deficit screen and the replan history all have something in
  // them.
  const TODAY = "2026-11-18";

  const past = await pool.query(
    `select id, to_char(date, 'YYYY-MM-DD') as date from session
      where course_id = $1 and date < $2 order by date`,
    [courseId, TODAY],
  );

  let conducted = 0;
  let cancelled = 0;

  for (const [index, session] of past.rows.entries()) {
    // Cancel roughly one class in nine: a strike, a conference, illness.
    const shouldCancel = index > 2 && index % 9 === 4;

    if (shouldCancel) {
      await updateSession(String(session.id), teacherId, {
        status: "cancelled",
        cancel_reason: pick([
          "University closed at short notice",
          "Teacher away at a conference",
          "Department seminar clashed with the class",
        ]),
      });
      cancelled += 1;
      continue;
    }

    // Attendance marks the class conducted, which is what a real teacher does.
    const absentees = studentIds.filter(() => random() < 0.12);
    const onLeave = studentIds.filter((id) => !absentees.includes(id) && random() < 0.02);

    await submitAttendance(String(session.id), teacherId, {
      absent: absentees,
      leave: onLeave,
    });
    conducted += 1;
  }

  log("classes conducted", `${conducted}`);
  log("classes cancelled", `${cancelled}`);

  // 8. Marks for everything that has already happened ----------------------
  let marksEntered = 0;

  for (const assessment of assessmentIds) {
    if (assessment.type === "final") continue; // not sat yet

    // Quiz 4 is deliberately left half-entered, so the dashboard has a real
    // "marks outstanding" entry and the result sheet has a real missing mark.
    const partial = assessment.title === "Quiz 4";
    const targets = partial ? studentIds.slice(0, 28) : studentIds;

    const marks = targets.map((studentId) => {
      // About 3% of students miss a paper entirely.
      if (random() < 0.03) return { student_id: studentId, is_absent: true };

      // A believable bell-ish curve centred near 70%.
      const spread = (random() + random() + random()) / 3;
      const fraction = Math.min(1, Math.max(0.2, 0.35 + spread * 0.7));

      return {
        student_id: studentId,
        obtained: Math.round(fraction * assessment.total * 2) / 2,
      };
    });

    const saved = await saveMarks(String(assessment.id), teacherId, { marks });
    marksEntered += saved.saved;
  }

  log("marks entered", `${marksEntered}`);

  // 9. Replan, because the cancellations pushed everything back ------------
  const replanned = await replanCourse(
    courseId,
    teacherId,
    TODAY,
    `${cancelled} classes were cancelled during the semester`,
  );

  log("replan: frozen", `${replanned.frozen} conducted classes untouched`);
  log("replan: rebuilt", `${replanned.sessions.length} future classes`);
  log("replan: changes", `${replanned.changes.length} reported to the teacher`);

  if (replanned.deficit > 0) {
    log("deficit", `${replanned.deficit} classes short`);

    const options = await getDeficitOptions(courseId, teacherId, TODAY);
    console.log("\n    Three ways out:");
    console.log(
      `      DROP     ${options.drop.topics.map((t) => t.title).join(", ") || "nothing to drop"}` +
        `  (+${options.drop.sessions_recovered})`,
    );
    console.log(
      `      COMPRESS ${options.compress.topics.map((t) => `${t.title} ${t.from}->${t.to}`).join(", ") || "no slack"}` +
        `  (+${options.compress.sessions_recovered})`,
    );
    console.log(
      `      EXTEND   ${options.extend.dates.join(", ") || "no free dates"}` +
        `  (+${options.extend.sessions_recovered})`,
    );
    console.log("");
  } else {
    log("deficit", "none — everything still fits");
  }

  // 10. Some course material ----------------------------------------------
  await pool.query(
    `insert into material (course_id, topic_id, title, storage_path, mime_type, size_bytes)
     select $1, t.topic_id, t.title, t.path, 'application/pdf', t.size
       from unnest($2::bigint[], $3::text[], $4::text[], $5::bigint[])
         as t(topic_id, title, path, size)`,
    [
      courseId,
      [
        topicIdByOrder.get(3) ?? null,
        topicIdByOrder.get(5) ?? null,
        topicIdByOrder.get(8) ?? null,
        null,
      ],
      [
        "ER Modelling Slides",
        "SQL Practice Sheet",
        "Normalization Worked Examples",
        "Course Outline",
      ],
      [
        `${courseId}/er-modelling-slides.pdf`,
        `${courseId}/sql-practice-sheet.pdf`,
        `${courseId}/normalization-examples.pdf`,
        `${courseId}/course-outline.pdf`,
      ],
      [2_400_000, 880_000, 1_350_000, 320_000],
    ],
  );
  log("material records", "4");

  // 11. Prove the grading pipeline works ----------------------------------
  await getWeightage(courseId, teacherId);
  await getGradeScale(courseId, teacherId);

  const results = await getResults(courseId, teacherId);

  console.log("\n  Results so far (the Final has not been sat):");
  log("class average", `${results.summary.class_average}%`);
  log("highest / lowest", `${results.summary.highest}% / ${results.summary.lowest}%`);
  log(
    "grade distribution",
    Object.entries(results.summary.grade_distribution)
      .filter(([, n]) => n > 0)
      .map(([g, n]) => `${g}:${n}`)
      .join("  "),
  );
  log("missing marks", `${results.summary.students_with_missing_marks} student(s)`);

  const health = await getDashboard(courseId, teacherId, TODAY);
  console.log("");
  log("schedule warning", health.schedule.warning ?? "on schedule");
  log("syllabus covered", `${health.schedule.syllabus_percent}%`);
  log("below attendance threshold", `${health.attendance.below_threshold_count} student(s)`);

  console.log(
    `\nDone. Course id ${courseId}. Pass today=${TODAY} to the dashboard and` +
      ` deficit endpoints to see it in this state.\n`,
  );
}

main()
  .catch((err) => {
    console.error("\nSeeding failed:\n", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
