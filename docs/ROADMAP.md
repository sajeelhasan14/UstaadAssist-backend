# UstaadAssist — beyond the university project

Ideas deliberately **out of scope** for the graded version, kept here so the reasoning is not lost.

Nothing in this file is to be built as part of the university project. `CLAUDE.md` is the scope. This is what comes after.

---

## 1. AI-assisted quiz analysis

**Status:** cut from v1 on 22 September 2026. Planned as the first post-submission feature.

### Why it was cut

Topic-wise analysis needs to know which question tested which topic. The only way to get that in v1 was to make the teacher tag every question by hand — pick a topic, set the marks, ten times per quiz. That is exactly the kind of typing the app is supposed to remove, and it is the weakest point of an otherwise low-input product.

Rather than ship a chore, the feature waits for the version that can do it properly.

### What replaces it

The teacher photographs the **question paper**. The system:

1. Reads the questions off the paper
2. Compares each one against the course outline — the topic list is already in the database
3. Assigns each question a topic, and its marks
4. Shows the teacher a review screen to correct anything wrong

The teacher tags nothing. They take one photo.

This mirrors how the class list already works in v1: **capture → extract → review → confirm.** The review step is mandatory for the same reason it is mandatory there — an extraction is a draft, and the teacher's confirmation is what makes it real.

### What it unlocks

Once questions carry topics, the rest already has a design:

- per-question marks entry, with every question starting at full marks so only deductions are tapped
- class performance **per topic**, not per quiz — "Normalization 41%" instead of "Quiz 3 62%"
- a weak topic flagged on the dashboard, with an offer to schedule a revision session
- the planner scheduling that revision session, closing the loop: plan → teach → assess → detect the gap → replan

### What it needs

- a vision model that can read a question paper and return structured questions
- the `quiz_question` and `question_score` tables (designed in v1, then dropped — see git history of this file's sibling migration)
- `assessment.marking_mode` to distinguish a total-marked assessment from a per-question one
- endpoints for questions and per-question scores
- screens: question review, per-question marks entry, topic analysis

---

## 2. Other ideas, not yet worked through

Recorded so they are not forgotten. None of these have been designed.

- **Auto-marking from a scanned answer sheet** — the natural extension once question papers can be read
- **Cross-semester analytics** — is this topic always the one the class fails, or was it this cohort?
- **Suggested plans** — given a course outline, propose `sessions_needed` per topic from how similar courses ran before
- **Multi-teacher courses** — sections, shared plans, a course taught by two people
- **Student-facing view** — attendance and marks visible to the student, read-only

---

## How to use this file

When a feature is pulled out of scope, it gets written here with **why**, not just what. A year from now the useful part is the reasoning, not the list.

When a feature moves from here into scope, it moves into `CLAUDE.md` and this entry is deleted.
