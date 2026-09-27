/**
 * Result computation — Section 3.8.
 *
 * PURE. No database, no PDF, no Express. Data in, data out.
 *
 * This is deliberate and it matters: the results SCREEN and the result PDF both
 * call this one function, so the number a student sees on the phone and the
 * number printed on the sheet can never disagree. CLAUDE.md: "Never calculate
 * inside the PDF code."
 *
 * Three rules that are easy to get wrong:
 *
 *   1. ROUND ONCE, AT THE END. Rounding each component and then adding them up
 *      drifts by a percent or more, which can move a student across a grade
 *      boundary.
 *
 *   2. A MISSING MARK IS NOT A ZERO. If the teacher has not entered a mark yet,
 *      that assessment is left out of the sum entirely and the student is
 *      flagged. Treating it as zero would fail a student for the teacher's
 *      unfinished data entry.
 *
 *   3. AN ABSENT STUDENT IS A ZERO. `is_absent` means they sat no paper, which
 *      is a real zero, and that is different from the teacher not having typed
 *      the mark in yet.
 */

export type Component = "quiz" | "assignment" | "midterm" | "final" | "participation";

export const COMPONENTS: Component[] = [
  "quiz",
  "assignment",
  "midterm",
  "final",
  "participation",
];

export type GradingAssessment = {
  id: number;
  type: Component;
  title: string;
  total_marks: number;
};

export type GradingMark = {
  assessment_id: number;
  student_id: number;
  /** null means the teacher has not entered it yet. */
  obtained: number | null;
  is_absent: boolean;
};

export type GradingStudent = { id: number; roll_no: string; name: string };

/** One row of the grade scale, for example { grade: "A", min_percentage: 85 }. */
export type GradeBand = { grade: string; min_percentage: number };

export type GradingInput = {
  students: GradingStudent[];
  assessments: GradingAssessment[];
  marks: GradingMark[];
  /** component -> percentage of the final result. Should total 100. */
  weightage: Record<string, number>;
  gradeScale: GradeBand[];
};

export type ComponentResult = {
  component: Component;
  weight: number;
  /** Marks scored across every assessment of this type that has a mark. */
  obtained: number;
  /** Marks available across those same assessments. */
  out_of: number;
  /** obtained / out_of as a percentage, or null when nothing counted yet. */
  percentage: number | null;
  /** This component's share of the final result. */
  contribution: number;
  /** Assessments of this type with no mark entered for this student. */
  missing: { assessment_id: number; title: string }[];
};

export type StudentResult = {
  student_id: number;
  roll_no: string;
  name: string;
  components: ComponentResult[];
  /** The final weighted percentage, rounded to 2 decimal places. */
  weighted_total: number;
  grade: string;
  /** True when at least one mark is still missing, so the total is provisional. */
  has_missing_marks: boolean;
  missing_count: number;
};

export type ClassSummary = {
  student_count: number;
  class_average: number | null;
  highest: number | null;
  lowest: number | null;
  /** grade -> how many students got it. */
  grade_distribution: Record<string, number>;
  pass_count: number;
  fail_count: number;
  students_with_missing_marks: number;
};

export type ResultSet = {
  students: StudentResult[];
  summary: ClassSummary;
  /** The weightage actually used, so the screen and the PDF can print it. */
  weightage: Record<string, number>;
  grade_scale: GradeBand[];
};

/** Round to 2 decimal places. Used once per student, at the very end. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Find the letter grade for a percentage.
 *
 * The scale is walked from the highest minimum downwards, and the first band the
 * percentage reaches wins. The scale is never hardcoded — universities differ,
 * so it is stored per course and the teacher can edit it.
 */
export function gradeFor(percentage: number, scale: GradeBand[]): string {
  const bands = [...scale].sort((a, b) => b.min_percentage - a.min_percentage);

  for (const band of bands) {
    if (percentage >= band.min_percentage) return band.grade;
  }

  // Below every band: the lowest grade on the scale.
  return bands[bands.length - 1]?.grade ?? "-";
}

/** Is this grade a pass? The lowest band on the scale is the failing one. */
function isPass(grade: string, scale: GradeBand[]): boolean {
  const bands = [...scale].sort((a, b) => b.min_percentage - a.min_percentage);
  const lowest = bands[bands.length - 1];
  return lowest === undefined ? true : grade !== lowest.grade;
}

export function computeResults(input: GradingInput): ResultSet {
  const { students, assessments, marks, weightage, gradeScale } = input;

  // Look a mark up by student and assessment without scanning the list each time.
  const markBy = new Map<string, GradingMark>();
  for (const m of marks) {
    markBy.set(`${m.student_id}:${m.assessment_id}`, m);
  }

  const byComponent = new Map<Component, GradingAssessment[]>();
  for (const a of assessments) {
    const list = byComponent.get(a.type) ?? [];
    list.push(a);
    byComponent.set(a.type, list);
  }

  const results: StudentResult[] = students.map((student) => {
    const components: ComponentResult[] = [];
    let weightedSum = 0;
    let missingCount = 0;

    for (const component of COMPONENTS) {
      const weight = weightage[component] ?? 0;
      const list = byComponent.get(component) ?? [];

      let obtained = 0;
      let outOf = 0;
      const missing: ComponentResult["missing"] = [];

      for (const assessment of list) {
        const mark = markBy.get(`${student.id}:${assessment.id}`);

        // Rule 2: no mark entered — leave it out, and say so.
        if (mark === undefined || (mark.obtained === null && !mark.is_absent)) {
          missing.push({ assessment_id: assessment.id, title: assessment.title });
          missingCount += 1;
          continue;
        }

        // Rule 3: absent is a real zero, and the paper still counts against them.
        obtained += mark.is_absent ? 0 : (mark.obtained ?? 0);
        outOf += assessment.total_marks;
      }

      const percentage = outOf === 0 ? null : (obtained / outOf) * 100;
      const contribution = percentage === null ? 0 : (percentage * weight) / 100;

      weightedSum += contribution;

      components.push({
        component,
        weight,
        obtained,
        out_of: outOf,
        percentage,
        contribution,
        missing,
      });
    }

    // Rule 1: the only rounding in the whole calculation happens here.
    const weightedTotal = round2(weightedSum);

    return {
      student_id: student.id,
      roll_no: student.roll_no,
      name: student.name,
      components: components.map((c) => ({
        ...c,
        percentage: c.percentage === null ? null : round2(c.percentage),
        contribution: round2(c.contribution),
      })),
      weighted_total: weightedTotal,
      grade: gradeFor(weightedTotal, gradeScale),
      has_missing_marks: missingCount > 0,
      missing_count: missingCount,
    };
  });

  return {
    students: results,
    summary: summarise(results, gradeScale),
    weightage,
    grade_scale: gradeScale,
  };
}

/** The class-level numbers the dashboard and the PDF footer both need. */
function summarise(results: StudentResult[], scale: GradeBand[]): ClassSummary {
  const distribution: Record<string, number> = {};
  for (const band of scale) distribution[band.grade] = 0;

  let pass = 0;
  for (const r of results) {
    distribution[r.grade] = (distribution[r.grade] ?? 0) + 1;
    if (isPass(r.grade, scale)) pass += 1;
  }

  const totals = results.map((r) => r.weighted_total);

  return {
    student_count: results.length,
    class_average:
      totals.length === 0
        ? null
        : round2(totals.reduce((sum, t) => sum + t, 0) / totals.length),
    highest: totals.length === 0 ? null : Math.max(...totals),
    lowest: totals.length === 0 ? null : Math.min(...totals),
    grade_distribution: distribution,
    pass_count: pass,
    fail_count: results.length - pass,
    students_with_missing_marks: results.filter((r) => r.has_missing_marks).length,
  };
}

/** The scale a new course starts with. The teacher edits it from there. */
export const DEFAULT_GRADE_SCALE: GradeBand[] = [
  { grade: "A", min_percentage: 85 },
  { grade: "A-", min_percentage: 80 },
  { grade: "B+", min_percentage: 75 },
  { grade: "B", min_percentage: 70 },
  { grade: "B-", min_percentage: 65 },
  { grade: "C+", min_percentage: 60 },
  { grade: "C", min_percentage: 55 },
  { grade: "C-", min_percentage: 50 },
  { grade: "D", min_percentage: 45 },
  { grade: "F", min_percentage: 0 },
];

/** The weightage a new course starts with. Totals 100. */
export const DEFAULT_WEIGHTAGE: Record<Component, number> = {
  quiz: 15,
  assignment: 10,
  midterm: 25,
  final: 45,
  participation: 5,
};
