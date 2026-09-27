# 7 · The grading engine

> The second pure calculation. It takes marks and weightage and produces every student's weighted total and letter grade. `src/grading/compute.ts`, 15 tests.

## Why it is separate from the PDF

The spec is blunt about this: *"Computation is a pure function, kept separate from PDF rendering. Never calculate inside the PDF code."*

The reason is a specific failure it prevents. If the results *screen* computed the totals and the result *PDF* computed them too, there would be two implementations of the same arithmetic. They would agree at first and then drift — someone fixes a rounding bug in one and forgets the other. Then a student sees 76.5% on the phone and 76% on the printed sheet, and the whole thing loses credibility.

Here there is one function. The screen calls it. The PDF calls it. They cannot disagree, because there is nothing to disagree about.

```
                    computeResults()      <- one function, pure
                     /            \
    GET /courses/:id/results    buildResultReport()
         (the screen)              (the PDF data)
```

## The three rules

### Rule 1 — round once, at the end

```
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
```

Called in exactly one place per student: after the weighted sum is complete.

Why it matters. Suppose three components each score 33.3333…% with weights adding to 100.

| Approach | Working | Result |
|---|---|---|
| *Round each component first* | 33.33 + 33.33 + 33.34, each already rounded | drifts |
| *Round once at the end* | 33.3333… summed, then rounded | exact |

The drift is small — usually well under a percent. But grade boundaries are exact numbers. A student on 84.996% should be an A- (the boundary is 85). Accumulated rounding can push them to 85.0 and hand them an A they did not earn, or the reverse.

The test `a borderline total is not pushed over a grade boundary by early rounding` uses 5 out of 6 = 83.333…%, and checks the result is `83.33` and the grade is `A-`, not `A`.

!NOTE Component percentages *are* rounded, but only for display — `components.map((c) => ({ ...c, percentage: round2(c.percentage) }))` happens *after* `weightedSum` has already been calculated from the unrounded values. The rounded numbers are shown; the exact ones are used.

### Rule 2 — a missing mark is not a zero

```
const mark = markBy.get(`${student.id}:${assessment.id}`);

if (mark === undefined || (mark.obtained === null && !mark.is_absent)) {
  missing.push({ assessment_id: assessment.id, title: assessment.title });
  missingCount += 1;
  continue;
}
```

`continue` — the assessment is skipped entirely. It is left out of *both* the numerator and the denominator.

So a student with 8/10 on Quiz 1 and nothing entered for Quiz 2 has a quiz percentage of *80%* (8 out of 10), not 40% (8 out of 20).

The alternative — treating it as zero — would mean that halfway through entering the final exam, every student not yet reached appears to be failing. A teacher glancing at the dashboard would see a catastrophe that is really just unfinished data entry.

And the student is *flagged*, not quietly adjusted:

```
has_missing_marks: missingCount > 0,
missing_count: missingCount,
```

The result PDF names them explicitly:

```
The totals below are provisional for the students listed here, because at least
one mark has not been entered. A missing mark is not counted as zero.

CT-21007 Hira Malik: mark not entered for Quiz 4.
```

### Rule 3 — an absent student is a zero

```
obtained += mark.is_absent ? 0 : (mark.obtained ?? 0);
outOf += assessment.total_marks;
```

Note that `outOf` increases *either way*. An absent student scores zero out of the full marks — the paper counts against them.

This is the opposite of Rule 2 and the distinction is the whole point. Three different situations:

| Situation | `obtained` | `is_absent` | Numerator | Denominator | Flagged missing? |
|---|---|---|---|---|---|
| Not entered yet | `null` | `false` | — | — | *yes* |
| Sat it, scored 0 | `0` | `false` | `+0` | `+total` | no |
| Did not sit it | `null` | `true` | `+0` | `+total` | no |

The test `absent and not-entered give different results for the same student` proves rows two and three of that table produce 50% and 100% respectively for the same student — which is exactly right, because in one case the teacher has recorded a fact and in the other they have not finished typing.

PAGEBREAK

## How the calculation actually runs

### Setting up two lookups

```
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
```

The first maps `"12:34"` — student 12, assessment 34 — to that mark. The second groups assessments by type, so all the quizzes are in one list.

Without these, finding one student's mark would mean scanning the whole marks array. For 42 students times 8 assessments that is 336 scans through 300-odd rows. With the `Map` it is 336 instant lookups.

### The per-student loop

For each student, for each of the five components:

```
for (const component of COMPONENTS) {
  const weight = weightage[component] ?? 0;
  const list = byComponent.get(component) ?? [];

  let obtained = 0;
  let outOf = 0;
  const missing: ComponentResult["missing"] = [];

  for (const assessment of list) {
    // ... the three rules above
  }

  const percentage = outOf === 0 ? null : (obtained / outOf) * 100;
  const contribution = percentage === null ? 0 : (percentage * weight) / 100;

  weightedSum += contribution;
  ...
}
```

- `weightage[component] ?? 0` — a component the teacher gave no weight contributes nothing.
- `outOf === 0 ? null : ...` — no assessments of this type, or all of them missing. `null`, not `0` — because "no quizzes exist" is not the same as "scored zero on the quizzes". Dividing by zero would give `NaN`, which would spread through every subsequent number.
- `contribution` — the component's percentage scaled by its weight. 85% on a component worth 20 contributes 17 points.

### Quizzes are summed, not averaged

This is a real decision and it is easy to get wrong. If a student scores 5/5 on Quiz 1 and 10/20 on Quiz 2:

| Method | Working | Result |
|---|---|---|
| Sum the marks *(what we do)* | 15 out of 25 | *60%* |
| Average the percentages | (100% + 50%) / 2 | 75% |

Summing is correct because a 20-mark quiz should count four times as much as a 5-mark one. Averaging the percentages treats them as equally important, which silently inflates the score of anyone who did well on a small paper.

The test `quizzes are added together, not averaged separately` uses exactly those numbers and asserts 60.

### The grade

```
export function gradeFor(percentage: number, scale: GradeBand[]): string {
  const bands = [...scale].sort((a, b) => b.min_percentage - a.min_percentage);

  for (const band of bands) {
    if (percentage >= band.min_percentage) return band.grade;
  }

  return bands[bands.length - 1]?.grade ?? "-";
}
```

Sort highest first, then return the first band the percentage reaches.

- `[...scale].sort(...)` — a copy, and the sort means the scale can arrive in *any* order and still work. The test `a scale given in the wrong order still works` covers it.
- `percentage >= band.min_percentage` — the boundary is inclusive. Exactly 85 is an A.
- The fallback after the loop is unreachable in practice, because the lowest band starts at 0. It is there so the function always returns a string rather than `undefined`.

### The scale is never hardcoded

`DEFAULT_GRADE_SCALE` is a ten-band scale seeded per course the first time it is asked for. The teacher can then replace it entirely, and `PUT /courses/:id/grade-scale` validates:

- every band needs a letter and a percentage between 0 and 100
- no duplicate letters
- the lowest band must start at 0, or a very low mark would have no grade at all

The test `the grade scale is not hardcoded` runs the same 82% mark through the default scale and a three-band scale, and gets `A-` and `A`. Different universities grade differently, so hardcoding would have made the app unusable outside one institution.

PAGEBREAK

## What comes out

```
export type StudentResult = {
  student_id: number;
  roll_no: string;
  name: string;
  components: ComponentResult[];
  weighted_total: number;
  grade: string;
  has_missing_marks: boolean;
  missing_count: number;
};
```

And the class summary:

```
export type ClassSummary = {
  student_count: number;
  class_average: number | null;
  highest: number | null;
  lowest: number | null;
  grade_distribution: Record<string, number>;
  pass_count: number;
  fail_count: number;
  students_with_missing_marks: number;
};
```

`| null` on the averages is not laziness — an empty class has no average, and `0` would be a lie. The test `an empty class does not crash the summary` checks all three come back `null`.

`isPass` treats the *lowest band on the scale* as the failing grade, whatever it is called. So a scale using `E` instead of `F` still counts correctly, without the code knowing anything about the letter `F`.

## The defaults a new course starts with

```
export const DEFAULT_WEIGHTAGE: Record<Component, number> = {
  quiz: 15, assignment: 10, midterm: 25, final: 45, participation: 5,
};
```

Totals 100. Seeded the first time `GET /courses/:id/weightage` is called, not at course creation — which is the minimum-input rule from the spec: *"Students, weightage and material are asked for later, only when the feature that needs them is opened."*

The teacher opens the grading screen and finds it already filled in with something sensible, and corrects it. They are never shown an empty form at setup time.

`PUT /courses/:id/weightage` enforces the total:

```
if (Math.abs(total - 100) > 0.01) {
  throw badRequest(`The weightage must total 100. It currently totals ${total}.`);
}
```

The `0.01` tolerance exists so `33.33 + 33.33 + 33.34` is accepted. Requiring exactly 100 with decimal inputs would reject legitimate splits.

## A worked example from the seeded demo

One student, with the default weightage, partway through the semester:

| Component | Weight | Marks | Percentage | Contribution |
|---|---|---|---|---|
| Quizzes | 15% | 24 / 30 | 80.00% | 12.00 |
| Assignments | 10% | 31 / 40 | 77.50% | 7.75 |
| Midterm | 25% | 38 / 50 | 76.00% | 19.00 |
| Final | 45% | *not sat* | — | 0.00 |
| Participation | 5% | *none set* | — | 0.00 |
| | | | *Weighted total* | *38.75* |

38.75% and a grade of F — and both are *correct*, because half the grade (the 45% final plus 5% participation) has not happened yet. The `has_missing_marks` flag is what tells the screen and the PDF to print this as provisional.

!NOTE This is worth understanding before the demo: a mid-semester result sheet *should* show low totals and failing grades. The number is not the story — the missing-mark flag is. Once the final is entered, every total moves up by up to 45 points. Showing the real, honest mid-semester figure is the design working, not a bug.
