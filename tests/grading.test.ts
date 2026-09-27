/**
 * Tests for result computation — Section 3.8.
 *
 * These guard the three rules that are easy to break and expensive to get wrong,
 * because a mistake here changes a real student's grade:
 *
 *   1. round once, at the end
 *   2. a missing mark is not a zero
 *   3. an absent student is a zero
 *
 * Run with:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  computeResults,
  gradeFor,
  DEFAULT_GRADE_SCALE,
  type GradingAssessment,
  type GradingMark,
} from "../src/grading/compute.ts";

const students = [
  { id: 1, roll_no: "CT-21001", name: "Ali" },
  { id: 2, roll_no: "CT-21002", name: "Sara" },
];

const assessments: GradingAssessment[] = [
  { id: 10, type: "quiz", title: "Quiz 1", total_marks: 10 },
  { id: 11, type: "quiz", title: "Quiz 2", total_marks: 10 },
  { id: 20, type: "midterm", title: "Midterm", total_marks: 50 },
  { id: 30, type: "final", title: "Final", total_marks: 100 },
];

const weightage = { quiz: 20, assignment: 0, midterm: 30, final: 50, participation: 0 };

function run(marks: GradingMark[]) {
  return computeResults({
    students,
    assessments,
    marks,
    weightage,
    gradeScale: DEFAULT_GRADE_SCALE,
  });
}

// ------------------------------------------------------ the weighted total

test("the weighted total is each component percentage times its weight", () => {
  const result = run([
    // 8/10 and 9/10 -> 17/20 = 85%
    { assessment_id: 10, student_id: 1, obtained: 8, is_absent: false },
    { assessment_id: 11, student_id: 1, obtained: 9, is_absent: false },
    // 40/50 = 80%
    { assessment_id: 20, student_id: 1, obtained: 40, is_absent: false },
    // 70/100 = 70%
    { assessment_id: 30, student_id: 1, obtained: 70, is_absent: false },
  ]);

  const ali = result.students.find((s) => s.student_id === 1)!;

  // 85*0.20 + 80*0.30 + 70*0.50 = 17 + 24 + 35 = 76
  assert.equal(ali.weighted_total, 76);
  assert.equal(ali.grade, "B+");
  assert.equal(ali.has_missing_marks, false);
});

test("quizzes are added together, not averaged separately", () => {
  // 3/10 and 10/10 is 13/20 = 65%, not (30% + 100%) / 2.
  // Both happen to give 65 here, so use uneven totals to tell them apart.
  const result = computeResults({
    students: [students[0]!],
    assessments: [
      { id: 10, type: "quiz", title: "Quiz 1", total_marks: 5 },
      { id: 11, type: "quiz", title: "Quiz 2", total_marks: 20 },
    ],
    marks: [
      { assessment_id: 10, student_id: 1, obtained: 5, is_absent: false },
      { assessment_id: 11, student_id: 1, obtained: 10, is_absent: false },
    ],
    weightage: { quiz: 100 },
    gradeScale: DEFAULT_GRADE_SCALE,
  });

  // 15 out of 25 = 60%. Averaging the two papers would give (100 + 50) / 2 = 75%.
  assert.equal(result.students[0]!.weighted_total, 60);
});

// -------------------------------------------------- rule 1: round once

test("rounding happens once at the end, not per component", () => {
  const result = computeResults({
    students: [students[0]!],
    assessments: [
      { id: 1, type: "quiz", title: "Q", total_marks: 3 },
      { id: 2, type: "midterm", title: "M", total_marks: 3 },
      { id: 3, type: "final", title: "F", total_marks: 3 },
    ],
    marks: [
      { assessment_id: 1, student_id: 1, obtained: 1, is_absent: false },
      { assessment_id: 2, student_id: 1, obtained: 1, is_absent: false },
      { assessment_id: 3, student_id: 1, obtained: 1, is_absent: false },
    ],
    // Each component is 33.333...%, each weighted a third.
    weightage: { quiz: 33.33, midterm: 33.33, final: 33.34 },
    gradeScale: DEFAULT_GRADE_SCALE,
  });

  // 33.3333... * (33.33 + 33.33 + 33.34) / 100 = 33.3333...
  // Rounding each component to 33.33 first and then adding gives 33.33,
  // which is a different number from the correctly rounded 33.33.
  const total = result.students[0]!.weighted_total;
  assert.ok(Math.abs(total - 33.33) < 0.01, `got ${total}`);

  // The component percentage is reported rounded for display...
  assert.equal(result.students[0]!.components[0]!.percentage, 33.33);
});

test("a borderline total is not pushed over a grade boundary by early rounding", () => {
  const result = computeResults({
    students: [students[0]!],
    assessments: [{ id: 1, type: "final", title: "F", total_marks: 6 }],
    marks: [{ assessment_id: 1, student_id: 1, obtained: 5, is_absent: false }],
    weightage: { final: 100 },
    gradeScale: DEFAULT_GRADE_SCALE,
  });

  // 5/6 = 83.333...%, which is A- (80), not A (85).
  assert.equal(result.students[0]!.weighted_total, 83.33);
  assert.equal(result.students[0]!.grade, "A-");
});

// ------------------------------------------- rule 2: missing is not zero

test("a mark that was never entered is reported missing, not counted as zero", () => {
  const result = run([
    { assessment_id: 10, student_id: 1, obtained: 8, is_absent: false },
    // Quiz 2, the midterm and the final have no row at all.
  ]);

  const ali = result.students.find((s) => s.student_id === 1)!;
  const quiz = ali.components.find((c) => c.component === "quiz")!;

  assert.equal(ali.has_missing_marks, true);
  assert.equal(ali.missing_count, 3, "Quiz 2, Midterm and Final");

  // The quiz component is 8 out of 10, not 8 out of 20. The unmarked paper is
  // left out of the denominator entirely.
  assert.equal(quiz.obtained, 8);
  assert.equal(quiz.out_of, 10);
  assert.equal(quiz.percentage, 80);

  assert.deepEqual(
    quiz.missing.map((m) => m.title),
    ["Quiz 2"],
  );
});

test("a NULL obtained is the same as no row: missing, not zero", () => {
  const result = run([{ assessment_id: 10, student_id: 1, obtained: null, is_absent: false }]);

  const quiz = result.students
    .find((s) => s.student_id === 1)!
    .components.find((c) => c.component === "quiz")!;

  assert.equal(quiz.out_of, 0, "nothing counted");
  assert.equal(quiz.percentage, null);
  assert.equal(quiz.missing.length, 2, "both quizzes are missing");
});

test("a student with nothing entered is not given a zero total by accident", () => {
  const result = run([]);

  for (const student of result.students) {
    assert.equal(student.has_missing_marks, true);
    assert.equal(student.missing_count, 4);
    // The total is 0 because nothing has been graded yet, and the flag is what
    // tells the screen and the PDF to print it as provisional.
    assert.equal(student.weighted_total, 0);
  }

  assert.equal(result.summary.students_with_missing_marks, 2);
});

// --------------------------------------------- rule 3: absent is a zero

test("an absent student scores zero and the paper still counts against them", () => {
  const result = run([
    { assessment_id: 10, student_id: 1, obtained: 10, is_absent: false },
    { assessment_id: 11, student_id: 1, obtained: null, is_absent: true },
  ]);

  const quiz = result.students
    .find((s) => s.student_id === 1)!
    .components.find((c) => c.component === "quiz")!;

  // 10 out of 20, because Quiz 2 counted as a zero out of 10.
  assert.equal(quiz.obtained, 10);
  assert.equal(quiz.out_of, 20);
  assert.equal(quiz.percentage, 50);

  // And crucially, it is NOT reported as missing — the teacher did record it.
  assert.equal(quiz.missing.length, 0);
});

test("absent and not-entered give different results for the same student", () => {
  const absent = run([
    { assessment_id: 10, student_id: 1, obtained: 10, is_absent: false },
    { assessment_id: 11, student_id: 1, obtained: null, is_absent: true },
  ]);

  const notEntered = run([
    { assessment_id: 10, student_id: 1, obtained: 10, is_absent: false },
  ]);

  const percentOf = (r: ReturnType<typeof run>) =>
    r.students.find((s) => s.student_id === 1)!.components.find((c) => c.component === "quiz")!
      .percentage;

  assert.equal(percentOf(absent), 50);
  assert.equal(percentOf(notEntered), 100);
});

// ------------------------------------------------------------ grade scale

test("the grade scale is not hardcoded: a different scale gives a different grade", () => {
  const marks: GradingMark[] = [
    { assessment_id: 30, student_id: 1, obtained: 82, is_absent: false },
  ];

  const strict = computeResults({
    students: [students[0]!],
    assessments: [assessments[3]!],
    marks,
    weightage: { final: 100 },
    gradeScale: DEFAULT_GRADE_SCALE,
  });

  const lenient = computeResults({
    students: [students[0]!],
    assessments: [assessments[3]!],
    marks,
    weightage: { final: 100 },
    gradeScale: [
      { grade: "A", min_percentage: 80 },
      { grade: "B", min_percentage: 60 },
      { grade: "F", min_percentage: 0 },
    ],
  });

  assert.equal(strict.students[0]!.grade, "A-");
  assert.equal(lenient.students[0]!.grade, "A");
});

test("gradeFor picks the highest band the mark reaches", () => {
  assert.equal(gradeFor(100, DEFAULT_GRADE_SCALE), "A");
  assert.equal(gradeFor(85, DEFAULT_GRADE_SCALE), "A", "exactly on the boundary");
  assert.equal(gradeFor(84.99, DEFAULT_GRADE_SCALE), "A-");
  assert.equal(gradeFor(0, DEFAULT_GRADE_SCALE), "F");
});

test("a scale given in the wrong order still works", () => {
  const scrambled = [
    { grade: "B", min_percentage: 60 },
    { grade: "F", min_percentage: 0 },
    { grade: "A", min_percentage: 80 },
  ];

  assert.equal(gradeFor(85, scrambled), "A");
  assert.equal(gradeFor(65, scrambled), "B");
  assert.equal(gradeFor(10, scrambled), "F");
});

// -------------------------------------------------------- class summary

test("the class summary counts, averages and distributes correctly", () => {
  const result = run([
    // Ali: everything full marks -> 100%
    { assessment_id: 10, student_id: 1, obtained: 10, is_absent: false },
    { assessment_id: 11, student_id: 1, obtained: 10, is_absent: false },
    { assessment_id: 20, student_id: 1, obtained: 50, is_absent: false },
    { assessment_id: 30, student_id: 1, obtained: 100, is_absent: false },
    // Sara: zero everywhere, recorded as absent -> 0%
    { assessment_id: 10, student_id: 2, obtained: null, is_absent: true },
    { assessment_id: 11, student_id: 2, obtained: null, is_absent: true },
    { assessment_id: 20, student_id: 2, obtained: null, is_absent: true },
    { assessment_id: 30, student_id: 2, obtained: null, is_absent: true },
  ]);

  assert.equal(result.summary.student_count, 2);
  assert.equal(result.summary.highest, 100);
  assert.equal(result.summary.lowest, 0);
  assert.equal(result.summary.class_average, 50);
  assert.equal(result.summary.pass_count, 1);
  assert.equal(result.summary.fail_count, 1);
  assert.equal(result.summary.grade_distribution["A"], 1);
  assert.equal(result.summary.grade_distribution["F"], 1);
  assert.equal(result.summary.students_with_missing_marks, 0, "absent is recorded, not missing");
});

test("an empty class does not crash the summary", () => {
  const result = computeResults({
    students: [],
    assessments,
    marks: [],
    weightage,
    gradeScale: DEFAULT_GRADE_SCALE,
  });

  assert.equal(result.summary.student_count, 0);
  assert.equal(result.summary.class_average, null);
  assert.equal(result.summary.highest, null);
  assert.equal(result.summary.lowest, null);
});

test("a component with no weight contributes nothing", () => {
  const result = run([
    { assessment_id: 10, student_id: 1, obtained: 10, is_absent: false },
    { assessment_id: 11, student_id: 1, obtained: 10, is_absent: false },
  ]);

  const participation = result.students
    .find((s) => s.student_id === 1)!
    .components.find((c) => c.component === "participation")!;

  assert.equal(participation.weight, 0);
  assert.equal(participation.contribution, 0);
  assert.equal(participation.percentage, null, "no participation assessment exists");
});
