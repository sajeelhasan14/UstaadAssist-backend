/**
 * Tests for the planner — the one part of this codebase that gets tests.
 *
 * Run with:  npm test
 *
 * These need no database, no server and no token, because every planner
 * function is pure: you hand it values and it hands back an answer.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { generateSlots, suggestMakeupDates } from "../src/planner/slots.ts";
import { allocateTopics, calculateDeficit } from "../src/planner/allocate.ts";
import type { PlannerTopic } from "../src/planner/allocate.ts";
import { validateAssessmentDates, firstSlotAfter } from "../src/planner/assessments.ts";

// ---------------------------------------------------------------- helpers

/** A topic with sensible defaults, so each test only states what it cares about. */
function topic(over: Partial<PlannerTopic> & { id: number; order_no: number }): PlannerTopic {
  return {
    title: `Topic ${over.id}`,
    sessions_needed: 1,
    min_sessions: 1,
    priority: "normal",
    ...over,
  };
}

const dayOf = (iso: string) =>
  ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(`${iso}T00:00:00Z`).getUTCDay()];

// ------------------------------------------------------------ 3.1 slots

test("slots land only on the days the teacher teaches", () => {
  const slots = generateSlots("2026-09-01", "2026-09-30", ["mon"], []);

  assert.equal(slots.length, 4, "September 2026 has four Mondays");
  for (const s of slots) assert.equal(dayOf(s.date), "mon");
});

test("two class days a week produce both", () => {
  const slots = generateSlots("2026-09-01", "2026-09-30", ["mon", "wed"], []);

  // 4 Mondays + 5 Wednesdays
  assert.equal(slots.length, 9);
  assert.equal(slots[0]!.date, "2026-09-02", "the first Wednesday comes before the first Monday");
});

test("holidays are removed from the slots", () => {
  const withHoliday = generateSlots("2026-09-01", "2026-09-30", ["mon"], ["2026-09-14"]);
  const without = generateSlots("2026-09-01", "2026-09-30", ["mon"], []);

  assert.equal(without.length, 4);
  assert.equal(withHoliday.length, 3, "one Monday was a holiday");
  assert.ok(!withHoliday.some((s) => s.date === "2026-09-14"));
});

test("a holiday on a day the teacher does not teach changes nothing", () => {
  const slots = generateSlots("2026-09-01", "2026-09-30", ["mon"], ["2026-09-02"]);
  assert.equal(slots.length, 4, "2 Sep is a Wednesday, so it was never a slot");
});

test("both the start and end dates are included", () => {
  // 7 Sep is a Monday, so it should appear when the semester starts on it.
  const slots = generateSlots("2026-09-07", "2026-09-07", ["mon"], []);
  assert.deepEqual(slots.map((s) => s.date), ["2026-09-07"]);
});

test("week numbers start at 1 and advance every seven days", () => {
  const slots = generateSlots("2026-09-01", "2026-09-30", ["mon"], []);

  assert.deepEqual(
    slots.map((s) => ({ date: s.date, week: s.week_no })),
    [
      { date: "2026-09-07", week: 1 },
      { date: "2026-09-14", week: 2 },
      { date: "2026-09-21", week: 3 },
      { date: "2026-09-28", week: 4 },
    ],
  );
});

test("a semester that crosses into the next year still works", () => {
  const slots = generateSlots("2026-12-28", "2027-01-11", ["mon"], []);
  assert.deepEqual(slots.map((s) => s.date), ["2026-12-28", "2027-01-04", "2027-01-11"]);
});

// -------------------------------------------------------- 3.2 allocation

test("one topic per slot when each needs a single class", () => {
  const slots = generateSlots("2026-09-01", "2026-09-30", ["mon"], []);
  const { sessions, overflow } = allocateTopics(slots, [
    topic({ id: 1, order_no: 1 }),
    topic({ id: 2, order_no: 2 }),
  ]);

  assert.equal(overflow.length, 0);
  assert.deepEqual(sessions.map((s) => s.topic_id), [1, 2]);
  assert.equal(sessions[0]!.part_no, null, "a single-class topic has no part number");
  assert.equal(sessions[0]!.total_parts, null);
});

test("a multi-session topic spans consecutive classes and is numbered", () => {
  const slots = generateSlots("2026-09-01", "2026-09-30", ["mon"], []);
  const { sessions } = allocateTopics(slots, [
    topic({ id: 1, order_no: 1, sessions_needed: 3, title: "Normalization" }),
    topic({ id: 2, order_no: 2 }),
  ]);

  assert.deepEqual(
    sessions.map((s) => ({ topic: s.topic_id, date: s.date, part: s.part_no, of: s.total_parts })),
    [
      { topic: 1, date: "2026-09-07", part: 1, of: 3 },
      { topic: 1, date: "2026-09-14", part: 2, of: 3 },
      { topic: 1, date: "2026-09-21", part: 3, of: 3 },
      { topic: 2, date: "2026-09-28", part: null, of: null },
    ],
  );
});

test("topics are placed in order_no order, not array order", () => {
  const slots = generateSlots("2026-09-01", "2026-09-30", ["mon"], []);
  const { sessions } = allocateTopics(slots, [
    topic({ id: 9, order_no: 2 }),
    topic({ id: 4, order_no: 1 }),
  ]);

  assert.deepEqual(sessions.map((s) => s.topic_id), [4, 9]);
});

test("topics that do not fit go to overflow, and the rest still get placed", () => {
  const slots = generateSlots("2026-09-01", "2026-09-30", ["mon"], []); // 4 slots
  const { sessions, overflow } = allocateTopics(slots, [
    topic({ id: 1, order_no: 1, sessions_needed: 4 }),
    topic({ id: 2, order_no: 2, title: "Recovery" }),
  ]);

  assert.equal(sessions.length, 4);
  assert.deepEqual(overflow.map((t) => t.title), ["Recovery"]);
});

test("a topic is never half-placed", () => {
  const slots = generateSlots("2026-09-01", "2026-09-30", ["mon"], []); // 4 slots
  const { sessions, overflow } = allocateTopics(slots, [
    topic({ id: 1, order_no: 1, sessions_needed: 3 }),
    topic({ id: 2, order_no: 2, sessions_needed: 3 }), // only 1 slot left, needs 3
  ]);

  assert.equal(sessions.length, 3, "topic 2 was skipped entirely, not given one class");
  assert.deepEqual(overflow.map((t) => t.id), [2]);
});

test("leftover slots are reported", () => {
  const slots = generateSlots("2026-09-01", "2026-09-30", ["mon"], []); // 4
  const { unusedSlots } = allocateTopics(slots, [topic({ id: 1, order_no: 1 })]);
  assert.equal(unusedSlots.length, 3);
});

// ---------------------------------------------------------- 3.5 deficit

test("deficit is how many extra classes are needed", () => {
  const remaining = [
    topic({ id: 1, order_no: 1, sessions_needed: 3 }),
    topic({ id: 2, order_no: 2, sessions_needed: 3 }),
    topic({ id: 3, order_no: 3, sessions_needed: 3 }),
  ];
  assert.equal(calculateDeficit(5, remaining), 4, "9 needed, 5 available");
});

test("deficit is zero or negative when everything fits", () => {
  const remaining = [topic({ id: 1, order_no: 1, sessions_needed: 2 })];
  assert.ok(calculateDeficit(5, remaining) <= 0);
});

// ------------------------------------------------- 3.3 assessment dates

test("a quiz moves when its topics will not be finished in time", () => {
  const slots = generateSlots("2026-09-01", "2026-10-31", ["mon"], []);
  const { sessions } = allocateTopics(slots, [
    topic({ id: 7, order_no: 1, sessions_needed: 3, title: "Normalization" }),
  ]);
  // Normalization finishes 2026-09-21.

  const moves = validateAssessmentDates(
    sessions,
    slots,
    [{ id: 3, title: "Quiz 3", date: "2026-09-14", topic_ids: [7] }],
    new Map([[7, "Normalization"]]),
  );

  assert.equal(moves.length, 1);
  assert.equal(moves[0]!.from, "2026-09-14");
  assert.equal(moves[0]!.to, "2026-09-28", "the next class date after the topic finishes");
  assert.match(moves[0]!.reason, /Quiz 3 moved from 14 Sep to 28 Sep because Normalization/);
});

test("a quiz scheduled after its topics is left alone", () => {
  const slots = generateSlots("2026-09-01", "2026-10-31", ["mon"], []);
  const { sessions } = allocateTopics(slots, [
    topic({ id: 7, order_no: 1, sessions_needed: 2, title: "Joins" }),
  ]);
  // Joins finishes 2026-09-14.

  const moves = validateAssessmentDates(
    sessions,
    slots,
    [{ id: 1, title: "Quiz 1", date: "2026-10-05", topic_ids: [7] }],
    new Map([[7, "Joins"]]),
  );

  assert.equal(moves.length, 0);
});

test("a quiz covering several topics waits for the last of them", () => {
  const slots = generateSlots("2026-09-01", "2026-10-31", ["mon"], []);
  const { sessions } = allocateTopics(slots, [
    topic({ id: 1, order_no: 1, title: "SQL Basics" }),
    topic({ id: 2, order_no: 2, sessions_needed: 2, title: "Joins" }),
  ]);
  // SQL Basics 7 Sep, Joins 14 + 21 Sep.

  const moves = validateAssessmentDates(
    sessions,
    slots,
    [{ id: 2, title: "Quiz 2", date: "2026-09-14", topic_ids: [1, 2] }],
    new Map([[1, "SQL Basics"], [2, "Joins"]]),
  );

  assert.equal(moves.length, 1);
  assert.equal(moves[0]!.to, "2026-09-28");
  assert.match(moves[0]!.reason, /Joins/, "the reason names the topic that finishes last");
});

test("an assessment with no date or no topics is ignored", () => {
  const slots = generateSlots("2026-09-01", "2026-10-31", ["mon"], []);
  const { sessions } = allocateTopics(slots, [topic({ id: 1, order_no: 1 })]);

  const moves = validateAssessmentDates(
    sessions,
    slots,
    [
      { id: 1, title: "No date", date: null, topic_ids: [1] },
      { id: 2, title: "No topics", date: "2026-09-01", topic_ids: [] },
    ],
    new Map(),
  );

  assert.equal(moves.length, 0);
});

// ------------------------------------------------- 3.5 makeup suggestions

test("firstSlotAfter finds the next class date by binary search", () => {
  const slots = generateSlots("2026-09-01", "2026-09-30", ["mon", "wed"], []);
  // Mondays and Wednesdays: 2, 7, 9, 14, 16, 21, 23, 28, 30 Sep.

  assert.equal(firstSlotAfter(slots, "2026-08-15"), "2026-09-02", "before every slot -> the first one");
  assert.equal(firstSlotAfter(slots, "2026-09-10"), "2026-09-14", "between two slots");
  assert.equal(firstSlotAfter(slots, "2026-09-14"), "2026-09-16", "ON a slot -> strictly the next one");
  assert.equal(firstSlotAfter(slots, "2026-09-30"), null, "on the last slot -> nothing after");
  assert.equal(firstSlotAfter([], "2026-09-10"), null, "no slots at all");
});

test("firstSlotAfter agrees with a plain left-to-right search on every date", () => {
  const slots = generateSlots("2026-09-01", "2026-12-31", ["tue", "thu"], ["2026-10-01"]);
  const linear = (date: string) => slots.find((s) => s.date > date)?.date ?? null;

  for (let day = 0; day < 140; day++) {
    const date = new Date(Date.UTC(2026, 7, 20 + day)).toISOString().slice(0, 10);
    assert.equal(firstSlotAfter(slots, date), linear(date), date);
  }
});

test("makeup dates avoid normal class days, Sundays and holidays", () => {
  const dates = suggestMakeupDates("2026-09-01", "2026-09-30", ["mon", "wed"], ["2026-09-04"], 3);

  assert.equal(dates.length, 3);
  for (const d of dates) {
    const day = dayOf(d);
    assert.ok(day !== "mon" && day !== "wed", `${d} is a normal class day`);
    assert.ok(day !== "sun", `${d} is a Sunday`);
    assert.ok(d !== "2026-09-04", "that day is a holiday");
    assert.ok(d > "2026-09-01", "must be after the given date");
  }
});
