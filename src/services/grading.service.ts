/**
 * Assessments, marks, weightage, grade scale and results (Module M4).
 *
 * The heavy thinking is not here. It is in src/grading/compute.ts, which is
 * pure. This file only loads rows, hands them to that function, and saves what
 * the teacher types.
 */

import { pool, transaction } from "../db/pool.ts";
import { badRequest, notFound } from "../http.ts";
import { assertCourseOwned, assertAssessmentOwned } from "./ownership.ts";
import {
  computeResults,
  COMPONENTS,
  DEFAULT_GRADE_SCALE,
  DEFAULT_WEIGHTAGE,
  type Component,
  type GradeBand,
  type ResultSet,
} from "../grading/compute.ts";

function asComponent(value: unknown): Component {
  if (typeof value === "string" && (COMPONENTS as string[]).includes(value)) {
    return value as Component;
  }
  throw badRequest(`type must be one of: ${COMPONENTS.join(", ")}`);
}

// ------------------------------------------------------------ assessments

/** POST /courses/:id/assessments — create a quiz, assignment, midterm or final. */
export async function createAssessment(
  courseId: string,
  teacherId: string,
  body: { type?: unknown; title?: unknown; date?: unknown; total_marks?: unknown; topic_ids?: unknown },
) {
  await assertCourseOwned(courseId, teacherId);

  const type = asComponent(body.type);

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (title === "") throw badRequest("title is required");

  const totalMarks = Number(body.total_marks);
  if (!Number.isFinite(totalMarks) || totalMarks <= 0) {
    throw badRequest("total_marks must be a number greater than 0");
  }

  const date = body.date === undefined || body.date === null ? null : String(body.date);
  if (date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw badRequest("date must be in YYYY-MM-DD form");
  }

  // Which topics this assessment covers. The planner needs these to check that
  // the quiz is not scheduled before those topics are taught (Section 3.3).
  const topicIds = Array.isArray(body.topic_ids) ? body.topic_ids.map(String) : [];

  return transaction(async (client) => {
    const created = await client.query(
      `insert into assessment (course_id, type, title, date, total_marks)
       values ($1, $2, $3, $4, $5)
       returning id, course_id, type, title, to_char(date, 'YYYY-MM-DD') as date,
                 total_marks, original_date, move_reason`,
      [courseId, type, title, date, totalMarks],
    );

    const assessment = created.rows[0];

    if (topicIds.length > 0) {
      // The `join topic` makes it impossible to attach a topic from somebody
      // else's course: a bad id simply matches no row.
      await client.query(
        `insert into assessment_topic (assessment_id, topic_id)
         select $1, t.id
           from topic t
          where t.id = any($2::bigint[]) and t.course_id = $3
         on conflict do nothing`,
        [assessment.id, topicIds, courseId],
      );
    }

    return { ...assessment, total_marks: Number(assessment.total_marks) };
  });
}

/** GET /courses/:id/assessments — every assessment, with how many marks are in. */
export async function listAssessments(courseId: string, teacherId: string) {
  await assertCourseOwned(courseId, teacherId);

  const result = await pool.query(
    `select a.id, a.type, a.title, to_char(a.date, 'YYYY-MM-DD') as date,
            a.total_marks,
            to_char(a.original_date, 'YYYY-MM-DD') as original_date,
            a.move_reason,
            count(m.id) filter (where m.obtained is not null or m.is_absent)::int as marks_entered,
            (select count(*) from enrollment e where e.course_id = a.course_id)::int as student_count,
            coalesce(
              array_agg(distinct at.topic_id) filter (where at.topic_id is not null),
              '{}'
            ) as topic_ids
       from assessment a
       left join mark m             on m.assessment_id = a.id
       left join assessment_topic at on at.assessment_id = a.id
      where a.course_id = $1
      group by a.id
      order by a.date nulls last, a.id`,
    [courseId],
  );

  return result.rows.map((r) => ({
    ...r,
    total_marks: Number(r.total_marks),
    topic_ids: (r.topic_ids as string[]).map(Number),
  }));
}

// ------------------------------------------------------------------ marks

/**
 * POST /assessments/:id/marks
 *
 * Body: { marks: [{ student_id: 12, obtained: 7.5 }, { student_id: 13, is_absent: true }] }
 *
 * The marks screen auto-advances down the class list, so the app sends whatever
 * the teacher has filled in so far. Sending it again overwrites.
 */
export async function saveMarks(
  assessmentId: string,
  teacherId: string,
  body: { marks?: unknown },
) {
  const courseId = await assertAssessmentOwned(assessmentId, teacherId);

  if (!Array.isArray(body.marks) || body.marks.length === 0) {
    throw badRequest("marks must be a non-empty array of { student_id, obtained }");
  }

  const assessment = await pool.query(
    `select total_marks from assessment where id = $1`,
    [assessmentId],
  );
  const totalMarks = Number(assessment.rows[0]?.total_marks ?? 0);

  const studentIds: string[] = [];
  const obtained: (number | null)[] = [];
  const absent: boolean[] = [];

  body.marks.forEach((row, index) => {
    const line = index + 1;

    if (row?.student_id === undefined || row.student_id === null) {
      throw badRequest(`Row ${line} has no student_id`);
    }

    const isAbsent = row.is_absent === true;
    let value: number | null = null;

    if (!isAbsent) {
      // Leaving `obtained` out or sending null clears the mark back to
      // "not entered". That is a real thing a teacher needs to do, so it is
      // allowed — and it stays NULL rather than becoming a 0.
      if (row.obtained !== undefined && row.obtained !== null && row.obtained !== "") {
        value = Number(row.obtained);

        if (!Number.isFinite(value)) {
          throw badRequest(`Row ${line}: obtained must be a number`);
        }
        if (value < 0) {
          throw badRequest(`Row ${line}: obtained cannot be negative`);
        }
        if (value > totalMarks) {
          throw badRequest(
            `Row ${line}: obtained (${value}) is more than the total marks (${totalMarks})`,
          );
        }
      }
    }

    studentIds.push(String(row.student_id));
    obtained.push(value);
    absent.push(isAbsent);
  });

  // The `join enrollment` means a student id from another class silently matches
  // nothing instead of being saved against this assessment.
  const result = await pool.query(
    `insert into mark (assessment_id, student_id, obtained, is_absent)
     select $1, r.student_id, r.obtained, r.is_absent
       from unnest($2::bigint[], $3::numeric[], $4::boolean[])
         as r(student_id, obtained, is_absent)
       join enrollment e on e.student_id = r.student_id and e.course_id = $5
     on conflict (assessment_id, student_id) do update
        set obtained   = excluded.obtained,
            is_absent  = excluded.is_absent,
            updated_at = now()
     returning student_id, obtained, is_absent`,
    [assessmentId, studentIds, obtained, absent, courseId],
  );

  return {
    saved: result.rowCount ?? 0,
    ignored: studentIds.length - (result.rowCount ?? 0),
    marks: result.rows.map((r) => ({
      ...r,
      obtained: r.obtained === null ? null : Number(r.obtained),
    })),
  };
}

/** GET /assessments/:id/marks — the whole class list, ready for the entry screen. */
export async function getMarks(assessmentId: string, teacherId: string) {
  const courseId = await assertAssessmentOwned(assessmentId, teacherId);

  const assessment = await pool.query(
    `select id, type, title, to_char(date, 'YYYY-MM-DD') as date, total_marks
       from assessment where id = $1`,
    [assessmentId],
  );

  const rows = await pool.query(
    `select s.id as student_id, s.roll_no, s.name,
            m.obtained, coalesce(m.is_absent, false) as is_absent
       from enrollment e
       join student s on s.id = e.student_id
       left join mark m on m.student_id = s.id and m.assessment_id = $1
      where e.course_id = $2
      order by s.roll_no`,
    [assessmentId, courseId],
  );

  const head = assessment.rows[0];
  if (!head) throw notFound("Assessment");

  return {
    assessment: { ...head, total_marks: Number(head.total_marks) },
    marks: rows.rows.map((r) => ({
      ...r,
      obtained: r.obtained === null ? null : Number(r.obtained),
    })),
  };
}

// ------------------------------------------------------- weightage & scale

/**
 * Read the course weightage, seeding the default the first time it is asked for.
 *
 * Nothing is asked at setup (Section 1: minimum input). The defaults appear the
 * first time the teacher opens the grading screen, already filled in, and they
 * correct them from there.
 */
export async function getWeightage(courseId: string, teacherId: string) {
  await assertCourseOwned(courseId, teacherId);

  const existing = await pool.query(
    `select component, percentage from weightage where course_id = $1`,
    [courseId],
  );

  if (existing.rowCount === 0) {
    const components = Object.keys(DEFAULT_WEIGHTAGE);
    await pool.query(
      `insert into weightage (course_id, component, percentage)
       select $1, w.component, w.percentage
         from unnest($2::text[], $3::numeric[]) as w(component, percentage)
       on conflict (course_id, component) do nothing`,
      [courseId, components, components.map((c) => DEFAULT_WEIGHTAGE[c as Component])],
    );

    return { ...DEFAULT_WEIGHTAGE, total: 100 };
  }

  const map: Record<string, number> = {};
  for (const row of existing.rows) map[row.component] = Number(row.percentage);

  return {
    ...map,
    total: Object.values(map).reduce((sum, v) => sum + v, 0),
  };
}

/** PUT /courses/:id/weightage — must total 100. */
export async function setWeightage(
  courseId: string,
  teacherId: string,
  body: Record<string, unknown>,
) {
  await assertCourseOwned(courseId, teacherId);

  const components: string[] = [];
  const percentages: number[] = [];
  let total = 0;

  for (const component of COMPONENTS) {
    const raw = body[component];
    const value = raw === undefined || raw === null || raw === "" ? 0 : Number(raw);

    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw badRequest(`${component} must be a number between 0 and 100`);
    }

    components.push(component);
    percentages.push(value);
    total += value;
  }

  // A rounding slack of 0.01 is allowed so 33.33 + 33.33 + 33.34 is accepted.
  if (Math.abs(total - 100) > 0.01) {
    throw badRequest(`The weightage must total 100. It currently totals ${total}.`);
  }

  await pool.query(
    `insert into weightage (course_id, component, percentage)
     select $1, w.component, w.percentage
       from unnest($2::text[], $3::numeric[]) as w(component, percentage)
     on conflict (course_id, component) do update set percentage = excluded.percentage`,
    [courseId, components, percentages],
  );

  return getWeightage(courseId, teacherId);
}

/** GET /courses/:id/grade-scale — seeding the default the first time. */
export async function getGradeScale(courseId: string, teacherId: string): Promise<GradeBand[]> {
  await assertCourseOwned(courseId, teacherId);

  const existing = await pool.query(
    `select grade, min_percentage from grade_scale where course_id = $1 order by order_no`,
    [courseId],
  );

  if (existing.rowCount === 0) {
    await pool.query(
      `insert into grade_scale (course_id, grade, min_percentage, order_no)
       select $1, g.grade, g.min_percentage, g.order_no
         from unnest($2::text[], $3::numeric[], $4::int[]) as g(grade, min_percentage, order_no)
       on conflict (course_id, grade) do nothing`,
      [
        courseId,
        DEFAULT_GRADE_SCALE.map((b) => b.grade),
        DEFAULT_GRADE_SCALE.map((b) => b.min_percentage),
        DEFAULT_GRADE_SCALE.map((_, i) => i + 1),
      ],
    );

    return DEFAULT_GRADE_SCALE;
  }

  return existing.rows.map((r) => ({
    grade: r.grade,
    min_percentage: Number(r.min_percentage),
  }));
}

/** PUT /courses/:id/grade-scale — replace the whole scale. */
export async function setGradeScale(
  courseId: string,
  teacherId: string,
  body: { bands?: unknown },
) {
  await assertCourseOwned(courseId, teacherId);

  if (!Array.isArray(body.bands) || body.bands.length === 0) {
    throw badRequest("bands must be a non-empty array of { grade, min_percentage }");
  }

  const bands: GradeBand[] = body.bands.map((band, index) => {
    const grade = typeof band?.grade === "string" ? band.grade.trim() : "";
    const min = Number(band?.min_percentage);

    if (grade === "") throw badRequest(`Band ${index + 1} has no grade letter`);
    if (!Number.isFinite(min) || min < 0 || min > 100) {
      throw badRequest(`Band ${index + 1}: min_percentage must be between 0 and 100`);
    }

    return { grade, min_percentage: min };
  });

  // Highest first, so order_no reads the way the teacher sees it on screen.
  bands.sort((a, b) => b.min_percentage - a.min_percentage);

  const letters = new Set(bands.map((b) => b.grade.toUpperCase()));
  if (letters.size !== bands.length) {
    throw badRequest("The same grade letter appears more than once");
  }

  // The bottom band must start at 0, or a very low mark would have no grade.
  if (bands[bands.length - 1]!.min_percentage !== 0) {
    throw badRequest("The lowest band must start at 0, so every mark gets a grade");
  }

  return transaction(async (client) => {
    await client.query(`delete from grade_scale where course_id = $1`, [courseId]);

    await client.query(
      `insert into grade_scale (course_id, grade, min_percentage, order_no)
       select $1, g.grade, g.min_percentage, g.order_no
         from unnest($2::text[], $3::numeric[], $4::int[]) as g(grade, min_percentage, order_no)`,
      [
        courseId,
        bands.map((b) => b.grade),
        bands.map((b) => b.min_percentage),
        bands.map((_, i) => i + 1),
      ],
    );

    return bands;
  });
}

// ---------------------------------------------------------------- results

/**
 * GET /courses/:id/results
 *
 * Loads everything, hands it to the pure computation, returns the answer.
 * The result PDF calls this same function, which is why the screen and the
 * document can never disagree.
 */
export async function getResults(courseId: string, teacherId: string): Promise<ResultSet> {
  await assertCourseOwned(courseId, teacherId);

  const weightage = await getWeightage(courseId, teacherId);
  const gradeScale = await getGradeScale(courseId, teacherId);

  const students = await pool.query(
    `select s.id, s.roll_no, s.name
       from enrollment e join student s on s.id = e.student_id
      where e.course_id = $1
      order by s.roll_no`,
    [courseId],
  );

  const assessments = await pool.query(
    `select id, type, title, total_marks from assessment where course_id = $1 order by id`,
    [courseId],
  );

  const marks = await pool.query(
    `select m.assessment_id, m.student_id, m.obtained, m.is_absent
       from mark m
       join assessment a on a.id = m.assessment_id
      where a.course_id = $1`,
    [courseId],
  );

  // `total` is a convenience field for the screen, not a component.
  const { total: _total, ...componentWeights } = weightage;

  return computeResults({
    students: students.rows.map((s) => ({
      id: Number(s.id),
      roll_no: s.roll_no,
      name: s.name,
    })),
    assessments: assessments.rows.map((a) => ({
      id: Number(a.id),
      type: a.type as Component,
      title: a.title,
      total_marks: Number(a.total_marks),
    })),
    marks: marks.rows.map((m) => ({
      assessment_id: Number(m.assessment_id),
      student_id: Number(m.student_id),
      obtained: m.obtained === null ? null : Number(m.obtained),
      is_absent: m.is_absent,
    })),
    weightage: componentWeights as Record<string, number>,
    gradeScale,
  });
}
