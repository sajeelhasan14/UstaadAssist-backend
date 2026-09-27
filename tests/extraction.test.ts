/**
 * Tests for class list and outline parsing (src/extraction).
 *
 * The fixtures follow the department's printed sheet layout, with made-up
 * names — real class lists belong in samples/, which is never committed.
 *
 * Run with:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";

import { mergeReadings, parseClassList } from "../src/extraction/classList.ts";
import { parseOutline } from "../src/extraction/outline.ts";

// What the PDF reader produces for the department's attendance sheet: the
// student rows, then the pages of father's names and percentages.
const SHEET = [
  "COURSE NO: SE - 454 COURS",
  "S# Seat No:",
  "Student Name",
  "1 EB24210106003 ALI RAZA",
  "2 EB24210106005 SARA KHAN",
  "3 EB24210106009 USMAN TARIQ",
  "4 EB23210106148 HINA MALIK",
  "66",
  "Signature of Course Superior",
  "Department of Computer Science",
  "Father's Name",
  "MUHAMMAD RAZA",
  "ABDUL KHAN",
  "0%",
];

// ---------------------------------------------------------------- class list

test("reads every student row from the sheet and nothing else", () => {
  const rows = parseClassList(SHEET);
  assert.deepEqual(
    rows.map((r) => [r.roll_no, r.name]),
    [
      ["EB24210106003", "ALI RAZA"],
      ["EB24210106005", "SARA KHAN"],
      ["EB24210106009", "USMAN TARIQ"],
      ["EB23210106148", "HINA MALIK"],
    ],
  );
  assert.ok(rows.every((r) => r.confidence >= 0.8), "clean PDF rows are not flagged");
});

test("a seat number printed twice stays two rows, so the review screen can flag it", () => {
  const rows = parseClassList(["21 EB24210106056 ALI RAZA", "22 EB24210106056 SARA KHAN"]);
  assert.equal(rows.length, 2);
});

test("table borders read by OCR are ignored", () => {
  const rows = parseClassList(["| 6 | EB24210106013 [ABU BAKR SIDDIQUI |"], true);
  assert.deepEqual([rows[0].roll_no, rows[0].name], ["EB24210106013", "ABU BAKR SIDDIQUI"]);
});

test("letters OCR mistakes for digits are corrected and the row is flagged", () => {
  const [row] = parseClassList(["E8242101O6OO3 ALI RAZA"], true);
  assert.equal(row.roll_no, "EB24210106003");
  assert.ok(row.confidence < 0.8, "a corrected seat number must be checked by the teacher");
});

test("a name on the line after its seat number is paired with it", () => {
  const rows = parseClassList(["EB24210106003", "ALI RAZA", "EB24210106005", "SARA KHAN"], true);
  assert.deepEqual(rows.map((r) => r.name), ["ALI RAZA", "SARA KHAN"]);
});

test("a name column read separately is paired by order only when the counts match", () => {
  const matching = parseClassList(["EB24210106003", "EB24210106005", "ALI RAZA", "SARA KHAN"], true);
  assert.deepEqual(matching.map((r) => r.name), ["ALI RAZA", "SARA KHAN"]);
  assert.ok(matching.every((r) => r.confidence < 0.8), "names paired by order are flagged");

  // One name missing: pairing would shift every name onto the wrong student.
  const missing = parseClassList(["EB24210106003", "EB24210106005", "EB24210106009", "ALI RAZA", "SARA KHAN"], true);
  assert.ok(missing.every((r) => r.name === null));
});

// ------------------------------------------------------------------- voting

test("readings vote: the name most readings agree on wins", () => {
  const rows = mergeReadings([
    [{ roll_no: "EB24210106003", name: "ALI RAZA", confidence: 0.85 }],
    [{ roll_no: "EB24210106003", name: "ALI RAZA", confidence: 0.85 }],
    [{ roll_no: "EB24210106003", name: "ALL RAZA", confidence: 0.85 }],
  ]);
  assert.equal(rows[0].name, "ALI RAZA");
  assert.ok(rows[0].confidence < 0.8, "readings disagreed on the letters, so the teacher checks it");
});

test("voting prefers the spelling with spaces, since OCR drops spaces", () => {
  const rows = mergeReadings([
    [{ roll_no: "EB24210106003", name: "ALIRAZA", confidence: 0.85 }],
    [{ roll_no: "EB24210106003", name: "ALIRAZA", confidence: 0.85 }],
    [{ roll_no: "EB24210106003", name: "ALI RAZA", confidence: 0.85 }],
  ]);
  assert.equal(rows[0].name, "ALI RAZA");
  assert.ok(rows[0].confidence >= 0.8);
});

test("a row only one reading saw, or a merged-looking name, is flagged", () => {
  const rows = mergeReadings([
    [
      { roll_no: "EB24210106003", name: "ALI RAZA", confidence: 0.85 },
      { roll_no: "EB24210106005", name: "SARAKHANAHMED", confidence: 0.85 },
    ],
    [
      { roll_no: "EB24210106005", name: "SARAKHANAHMED", confidence: 0.85 },
    ],
  ]);
  assert.ok(rows.find((r) => r.roll_no === "EB24210106003")!.confidence < 0.8, "seen by one reading");
  assert.ok(rows.find((r) => r.roll_no === "EB24210106005")!.confidence < 0.8, "looks like merged words");
});

test("voting keeps a genuinely duplicated seat number as two students", () => {
  const reading = [
    { roll_no: "EB24210106056", name: "ALI RAZA", confidence: 0.85 },
    { roll_no: "EB24210106056", name: "SARA KHAN", confidence: 0.85 },
  ];
  const rows = mergeReadings([reading, reading]);
  assert.deepEqual(rows.map((r) => r.name), ["ALI RAZA", "SARA KHAN"]);
});

// ------------------------------------------------------------------ outline

test("an outline's weekly schedule becomes topics with their length in classes", () => {
  const rows = parseOutline(
    [
      "Course Outline — Database Systems",
      "Week 1: Introduction to Databases",
      "Week 2-3: Entity Relationship Modelling",
      "Week 4: Normalization",
      "Week 5: Normalization",
      "Week 6: Midterm Examination",
      "Lecture 13 - SQL Joins",
      "Recommended Books",
    ],
    2, // the course meets twice a week
  );

  assert.deepEqual(
    rows.map((r) => [r.title, r.sessions_needed]),
    [
      ["Introduction to Databases", 2],
      ["Entity Relationship Modelling", 4],
      ["Normalization", 4], // two consecutive weeks merged into one topic
      ["SQL Joins", 1],
    ],
  );
});

test("a plain numbered list of topics works, with no length given", () => {
  const rows = parseOutline(["1. Relational Model", "2) SQL Basics", "• Transactions"], 2);
  assert.deepEqual(rows.map((r) => [r.title, r.sessions_needed]), [
    ["Relational Model", null],
    ["SQL Basics", null],
    ["Transactions", null],
  ]);
});
