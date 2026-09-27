# 6 · The planner — the graded core

> Six files, no database access in any of them, 40 tests. This is the part that makes the project more than a management system, and the part to be able to explain on a whiteboard.

## Why it is pure, and what "pure" means

A *pure* function has two properties: the same inputs always give the same output, and it changes nothing outside itself. No queries, no file writes, no reading the clock.

Every function in `src/planner/` is pure. The service loads the data, calls the planner, and writes the result back. The planner itself only calculates.

### The clock is an argument, not a fact

```
export type ReplanInput = {
  today: string;      // "2026-11-18"
  ...
};
```

`today` is *passed in*. The planner never calls `new Date()`.

This is the single decision that makes the whole thing testable. A test can say "pretend it is 18 November, five classes have been conducted, two were cancelled — what does the plan look like?" and get an answer instantly. If the planner read the clock, that test could only be run on one day of the year.

It also makes the demo possible: the seed script and the dashboard endpoint both accept `today`, so a whole semester can be shown off in September.

### Dates are strings in `YYYY-MM-DD`

The planner never handles a JavaScript `Date` across a function boundary. Inside `slots.ts`, dates are converted to `Date` objects fixed at midnight *UTC*, and converted straight back:

```
function parseDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);     // the Z forces UTC
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
```

And every calculation uses the UTC methods — `getUTCDay()`, `setUTCDate()` — never `getDay()` or `setDate()`.

!WARN Without the `Z`, `new Date("2026-09-01")` is interpreted in the *local* timezone. On a machine set to UTC+5, midnight local is 19:00 the previous day in UTC, so `getDay()` can report the wrong weekday and the planner generates a slot on a day the teacher does not teach. This class of bug is invisible in testing if your machine happens to be in UTC, and appears only in production. Using UTC throughout removes the possibility.

A useful side effect: `"2026-09-01" < "2026-11-18"` is `true` as a string comparison, because `YYYY-MM-DD` sorts alphabetically in date order. That is why the code can write `sessions.filter((s) => s.date <= today)` and be correct.

---

## `slots.ts` — Section 3.1, which dates can class happen on

A *slot* is one real date a class can be held: it falls on a day the teacher teaches, and it is not a holiday.

```
export function generateSlots(
  startDate: string,
  endDate: string,
  classDays: string[],
  holidays: string[],
): Slot[] {
  const teaches = new Set(classDays);
  const isHoliday = new Set(holidays);

  const start = parseDate(startDate);
  const end = parseDate(endDate);

  const slots: Slot[] = [];
  const cursor = new Date(start);

  while (cursor.getTime() <= end.getTime()) {
    const date = toISODate(cursor);
    const dayName = DAY_NAMES[cursor.getUTCDay()]!;

    if (teaches.has(dayName) && !isHoliday.has(date)) {
      const daysIn = Math.floor((cursor.getTime() - start.getTime()) / MS_PER_DAY);
      slots.push({ date, week_no: Math.floor(daysIn / 7) + 1 });
    }

    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return slots;
}
```

The algorithm is deliberately boring: walk one day at a time from the start date to the end date, and keep the ones that qualify.

- `new Set(classDays)` / `new Set(holidays)` — built once, outside the loop. Over a four-month semester the loop runs about 110 times; `Set.has()` is instant, whereas `holidays.includes()` would scan the array each time.
- `DAY_NAMES[cursor.getUTCDay()]` — `getUTCDay()` returns 0 for Sunday through 6 for Saturday, so `DAY_NAMES` is deliberately ordered `["sun","mon","tue","wed","thu","fri","sat"]` to line up with it.
- The week number — days since the start, divided by seven, plus one. So the first seven days are week 1. This is why `week_no` is relative to the course, not the calendar year.
- `cursor.setUTCDate(cursor.getUTCDate() + 1)` — the standard way to add a day. It handles month ends and leap years by itself: `setUTCDate(32)` on a 31-day month rolls into the 1st of the next month.

A worked example. Course from Monday 1 September to Sunday 20 September 2026, teaching Monday and Wednesday, with 2 September a holiday:

| Date | Weekday | Teaches? | Holiday? | Slot |
|---|---|---|---|---|
| 2026-09-01 | mon | yes | no | *week 1* |
| 2026-09-02 | tue | no | — | — |
| 2026-09-03 | wed | yes | no | *week 1* |
| 2026-09-07 | mon | yes | no | *week 2* |
| 2026-09-09 | wed | yes | no | *week 2* |
| 2026-09-14 | mon | yes | no | *week 3* |
| 2026-09-16 | wed | yes | no | *week 3* |

PAGEBREAK

### `suggestMakeupDates` — finding free days

Used by the "Extend" deficit option. It looks for days the teacher does *not* normally teach:

```
const isNormalClassDay = teaches.has(dayName);
const isSunday = dayName === "sun";

if (!isNormalClassDay && !isSunday && !isHoliday.has(date)) {
  found.push(date);
}
```

Sundays are excluded because a makeup class on a Sunday is not a realistic suggestion in this context. Holidays are excluded for the obvious reason. `cursor.setUTCDate(cursor.getUTCDate() + 1)` before the loop makes it *strictly* after the given date, so "after today" does not include today.

### `mergeExtraDates` — folding makeup classes back in

Once the teacher has agreed to a makeup date, it has to become a usable slot. It cannot come out of `generateSlots`, because by definition it is not a normal class day.

```
export function mergeExtraDates(slots: Slot[], extraDates: string[], startDate: string): Slot[] {
  if (extraDates.length === 0) return slots;

  const already = new Set(slots.map((s) => s.date));
  const start = parseDate(startDate);

  const extras: Slot[] = [];
  for (const date of extraDates) {
    if (already.has(date)) continue;
    already.add(date);

    const daysIn = Math.floor((parseDate(date).getTime() - start.getTime()) / MS_PER_DAY);
    extras.push({ date, week_no: Math.floor(daysIn / 7) + 1 });
  }

  return [...slots, ...extras].sort((a, b) => a.date.localeCompare(b.date));
}
```

Two details that matter:

- `already.add(date)` inside the loop, not just the check at the top — so the same makeup date appearing twice in the input only produces one slot.
- The final `.sort()` — the makeup date must land in *date order*, not be appended at the end. Otherwise the next topic allocated would be scheduled on the makeup date before the earlier regular classes, and the week-by-week screen would be out of sequence.

---

## `allocate.ts` — Section 3.2, spreading topics over slots

```
export function allocateTopics(slots: Slot[], topics: PlannerTopic[]): Allocation {
  const ordered = [...topics].sort((a, b) => a.order_no - b.order_no);

  const sessions: PlannedSession[] = [];
  const overflow: PlannerTopic[] = [];

  let next = 0;                     // index of the next free slot

  for (const topic of ordered) {
    const need = Math.max(1, topic.sessions_needed);

    if (next + need > slots.length) {
      overflow.push(topic);
      continue;
    }

    const spansSeveral = need > 1;

    for (let part = 1; part <= need; part++) {
      const slot = slots[next]!;
      next += 1;

      sessions.push({
        date: slot.date,
        week_no: slot.week_no,
        topic_id: topic.id,
        part_no: spansSeveral ? part : null,
        total_parts: spansSeveral ? need : null,
      });
    }
  }

  return { sessions, overflow, unusedSlots: slots.slice(next) };
}
```

The idea is one pointer walking through the slot list. Each topic consumes as many slots as it needs, and the pointer moves on.

- `[...topics].sort(...)` — a *copy* is sorted, so the caller's array is untouched. Sorting by `order_no` rather than trusting the input order means the service does not have to guarantee it.
- `Math.max(1, topic.sessions_needed)` — defensive. A topic needing zero classes would consume nothing and never be taught; treating it as 1 is the sane interpretation.
- `part_no` and `total_parts` are `null` for a single-class topic — so the app can show *"Normalization (2 of 3)"* only where it makes sense, rather than *"Introduction (1 of 1)"*.

### The one real design decision: a topic is never half-placed

```
if (next + need > slots.length) {
  overflow.push(topic);
  continue;
}
```

If a topic needs three classes and only two slots remain, the *whole topic* goes to overflow. It does not get two classes with the third missing.

The reasoning: two-thirds of Normalization taught and then abandoned is worse than the teacher being told clearly *"Normalization does not fit; here are your three options"*. Half-teaching hides the problem; overflow surfaces it, and surfacing it is what the deficit screen is for.

Note also `continue` rather than `break` — later topics are still tried. A short topic after a long one may well still fit, and dropping everything after the first failure would be needlessly pessimistic.

### `calculateDeficit`

```
export function calculateDeficit(slotsAvailable: number, topicsRemaining: PlannerTopic[]): number {
  const needed = topicsRemaining.reduce((total, t) => total + Math.max(1, t.sessions_needed), 0);
  return needed - slotsAvailable;
}
```

Straight from the spec: `deficit = sessions_still_needed - slots_still_available`. Zero or less means everything fits.

PAGEBREAK

## `assessments.ts` — Section 3.3, a quiz can never come before its topics

This is the rule the spec calls non-optional: *a quiz must never be scheduled before its topics are taught.*

The logic:

1. For each assessment, look at the topics it covers.
2. Find the *latest* date any of those topics is taught.
3. If the assessment is scheduled earlier than that, move it to the next available slot after that date.
4. Return a sentence the teacher can read.

The sentence is the part that matters for the demo:

```
Quiz 3 moved from 19 Oct to 11 Nov because Normalization
will not be completed before 4 Nov.
```

Three pieces of information: what moved, where to, and *why*. A plan that silently rearranges itself is untrustworthy; one that explains itself is a feature.

Details worth knowing:

- An assessment with *no date* or *no topics* is left alone. A final exam covering everything, or an assessment the teacher has not dated yet, should not be moved by this rule. The test `an assessment with no date or no topics is ignored` covers it.
- An assessment covering several topics waits for the *last* of them, not the first.
- An assessment already scheduled after its topics is left exactly where it is.
- The move target is *the next slot*, not "the last topic date plus one day" — a quiz has to land on a day there is a class.

The service then saves the move:

```
update assessment
   set date = $2,
       original_date = coalesce(original_date, $3),
       move_reason = $4
 where id = $1
```

`coalesce(original_date, $3)` keeps the *first* original date through repeated replans. If Quiz 3 was set for 19 Oct, moved to 11 Nov, then moved again to 18 Nov, `original_date` stays 19 Oct — which is what the teacher recognises.

---

## `replan.ts` — Section 3.4, freeze the past, rebuild the future

Triggered when a class is cancelled or a topic's `sessions_needed` changes mid-semester.

### The principle

- A class marked `conducted` is *never touched*.
- Dates from today onward are worked out again.
- Only teaching that has not happened yet is re-allocated.
- The result reports *what changed*, not just the new plan.

```
export function replan(input: ReplanInput): ReplanResult {
  const { today, startDate, endDate, classDays, holidays, existingSessions, topics } = input;
  const extraDates = input.extraDates ?? [];

  const frozen = existingSessions.filter((s) => s.status === "conducted");
  const oldPlanned = existingSessions.filter((s) => s.status === "planned");

  const taken = new Set(
    existingSessions.filter((s) => s.status !== "planned").map((s) => s.date),
  );
  const futureFrom = today > startDate ? today : startDate;

  const regular = generateSlots(futureFrom, endDate, classDays, holidays);
  const futureExtras = extraDates.filter((d) => d >= futureFrom && d <= endDate);

  const slots: Slot[] = mergeExtraDates(regular, futureExtras, startDate).filter(
    (s) => !taken.has(s.date),
  );

  const stillToTeach = remainingWork(topics, frozen);
  const { sessions, overflow } = allocateTopics(slots, stillToTeach);

  return {
    frozen,
    sessions,
    overflow,
    changes: describeChanges(oldPlanned, sessions, topics),
    slotsAvailable: slots.length,
    deficit: calculateDeficit(slots.length, stillToTeach),
  };
}
```

Reading the important lines:

- `futureFrom = today > startDate ? today : startDate` — if the semester has not started yet, rebuild from the start date rather than from today. Without this, replanning a future course would throw away the first weeks.
- `taken` and the `.filter((s) => !taken.has(s.date))` — a date that already holds a conducted or cancelled class is removed from the available slots. A conducted date is used up; a cancelled date is a day the class could not happen. Without the cancelled half, cancelling next Monday's class and replanning would put the same topic straight back on next Monday and nothing would move.
- `extraDates.filter((d) => d >= futureFrom ...)` — a makeup date in the past is not a future slot.

### `remainingWork` — how much of each topic is still owed

```
function remainingWork(topics: PlannerTopic[], conducted: ExistingSession[]): PlannerTopic[] {
  const taught = new Map<number, number>();
  for (const s of conducted) {
    if (s.topic_id === null) continue;
    taught.set(s.topic_id, (taught.get(s.topic_id) ?? 0) + 1);
  }

  const still: PlannerTopic[] = [];
  for (const t of topics) {
    const done = taught.get(t.id) ?? 0;
    const left = Math.max(1, t.sessions_needed) - done;
    if (left > 0) still.push({ ...t, sessions_needed: left });
  }
  return still;
}
```

This is the heart of "rebuild the future". A topic needing three classes with two already conducted still needs *one*, so it is pushed with `sessions_needed: 1`. A topic fully taught is not pushed at all.

`taught.set(s.topic_id, (taught.get(s.topic_id) ?? 0) + 1)` is the standard counting idiom: get the current count or zero, add one, put it back.

`{ ...t, sessions_needed: left }` makes a *copy* with a different value — the caller's topic objects are not modified. Purity again.

PAGEBREAK

### `describeChanges` — the "what moved" screen

The spec is explicit that the response must report what changed, not just the new plan. This function compares the old planned sessions with the new ones.

```
const group = <T extends { topic_id: number | null; date: string }>(rows: T[]) => {
  const byTopic = new Map<number, string[]>();
  for (const r of rows) {
    if (r.topic_id === null) continue;
    const list = byTopic.get(r.topic_id) ?? [];
    list.push(r.date);
    byTopic.set(r.topic_id, list);
  }
  for (const list of byTopic.values()) list.sort();
  return byTopic;
};
```

Group both the before and after lists by topic, with each topic's dates sorted. Then walk them side by side:

```
const longest = Math.max(oldDates.length, newDates.length);
for (let i = 0; i < longest; i++) {
  const from = oldDates[i];
  const to = newDates[i];

  if (from && to && from !== to) {
    changes.push({ kind: "moved", topic_id: topicId, topic: name, from, to });
  } else if (!from && to) {
    changes.push({ kind: "added", topic_id: topicId, topic: name, to });
  } else if (from && !to) {
    changes.push({ kind: "removed", topic_id: topicId, topic: name, from });
  }
}
```

Matching the *first* future class of a topic before against the *first* after, the second against the second, and so on. Three outcomes: it moved, it is new, or it is gone.

`Math.max(oldDates.length, newDates.length)` so neither list is cut short — a topic that gained a class shows an `added`, one that lost a class shows a `removed`.

The output is exactly what the app needs:

```
{ kind: "moved", topic_id: 2, topic: "Joins", from: "2026-09-14", to: "2026-09-21" }
```

---

## `deficit.ts` — Section 3.5, the demo highlight

When there is not enough time left, this is the response. *It does not throw an error.* It computes three ways out and lets the teacher choose.

### Option 1 — DROP: cut whole topics

```
const candidates = [...topics].sort((a, b) => {
  const byPriority = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
  return byPriority !== 0 ? byPriority : b.order_no - a.order_no;
});
```

Two-level sort. Lowest priority first; and between two topics of equal priority, the *later* one in the course goes first — because earlier topics tend to be the foundations the later ones build on. Dropping "Introduction to Databases" to save "NoSQL" would be the wrong way round.

Then take topics until the deficit is covered:

```
for (const t of candidates) {
  if (recovered >= deficit) break;
  const freed = Math.max(1, t.sessions_needed);
  chosen.push({ topic_id: t.id, title: t.title, sessions_freed: freed });
  recovered += freed;
}
```

A `high` priority topic is only ever reached if dropping every `low` and `normal` one was not enough.

### Option 2 — COMPRESS: shorten topics that have room

```
const withSlack = topics
  .map((t) => ({
    topic: t,
    slack: Math.max(1, t.sessions_needed) - Math.max(1, t.min_sessions),
  }))
  .filter((x) => x.slack > 0)
  .sort((a, b) => b.slack - a.slack);
```

*Slack* is how many classes a topic could lose before hitting its minimum. Topics with none are filtered out. The rest are sorted by most slack first, so the fewest topics are affected.

```
const take = Math.min(slack, deficit - recovered);
const from = Math.max(1, topic.sessions_needed);
chosen.push({ topic_id: topic.id, title: topic.title, from, to: from - take });
```

`Math.min(slack, deficit - recovered)` takes only what is needed — no point shrinking a topic by three classes when two would do. And `min_sessions` is never breached, because `take` can never exceed `slack`.

### Option 3 — EXTEND: add classes on days off

```
function buildExtend(deficit: number, candidates: string[]): ExtendOption {
  const dates = candidates.slice(0, deficit);
  return {
    type: "extend",
    sessions_recovered: dates.length,
    covers_deficit: dates.length >= deficit,
    dates,
  };
}
```

Take exactly as many free dates from `suggestMakeupDates` as the deficit requires.

### `covers_deficit` — the honesty flag

Every option carries it:

```
covers_deficit: recovered >= deficit
```

Because an option might not be enough. If the remaining topics are all at their minimum, compressing recovers nothing. If the semester is nearly over, there may be no free dates left. Rather than pretend, each option states plainly whether it actually solves the problem. The test `compress reports honestly when it cannot cover the whole deficit` exists for this.

### `applyDeficitOption` — putting the choice into effect

```
if (choice === "drop") {
  const dropped = new Set(options.drop.topics.map((t) => t.topic_id));
  return { topics: topics.filter((t) => !dropped.has(t.id)), droppedTopicIds: [...dropped], extraDates: [] };
}

if (choice === "compress") {
  const newLength = new Map(options.compress.topics.map((t) => [t.topic_id, t.to]));
  return {
    topics: topics.map((t) => newLength.has(t.id) ? { ...t, sessions_needed: newLength.get(t.id)! } : t),
    droppedTopicIds: [], extraDates: [],
  };
}

return { topics, droppedTopicIds: [], extraDates: options.extend.dates };
```

Still pure — it returns the *adjusted data*, it does not save anything. The service takes that result, writes it to the database, and runs the planner again.

PAGEBREAK

## `health.ts` — Section 3.6, how far behind are we

```
export function scheduleHealth(input: HealthInput): Health {
  const { today, classesPerWeek, sessions, totalTopics, completedTopics } = input;

  const plannedUpToToday = sessions.filter(
    (s) => s.date <= today && s.status !== "cancelled",
  ).length;

  const conducted = sessions.filter((s) => s.status === "conducted").length;
  const cancelled = sessions.filter((s) => s.status === "cancelled").length;

  const perWeek = Math.max(1, classesPerWeek);
  const behind = (plannedUpToToday - conducted) / perWeek;

  return {
    planned_up_to_today: plannedUpToToday,
    conducted,
    cancelled,
    behind_by_weeks: Math.round(behind * 10) / 10,
    syllabus_percent: totalTopics === 0 ? 0 : Math.round((completedTopics / totalTopics) * 100),
    total_sessions: sessions.length,
  };
}
```

The formula from the spec:

```
behind_by_weeks = (sessions_planned_up_to_today - sessions_conducted) / classes_per_week
```

Three details:

- `s.status !== "cancelled"` in the first filter. *A cancelled class was never an opportunity.* If a cancelled class counted as "should have happened", the teacher would be reported as behind for a class the university closed. The test `a cancelled class does not count as being behind` locks this in.
- `Math.round(behind * 10) / 10` — one decimal place. Multiply by ten, round to a whole number, divide by ten. `1.4666...` becomes `1.5`.
- `Math.max(1, classesPerWeek)` — guards against dividing by zero, which would produce `Infinity` on the dashboard.

The dashboard then turns the number into the sentence:

```
warning: health.behind_by_weeks >= 0.5
  ? `You are ${health.behind_by_weeks} week${health.behind_by_weeks === 1 ? "" : "s"} behind your plan.`
  : null
```

Below half a week it says nothing, because being a single class behind is normal and a permanent warning would be ignored.

---

## The tests

`npm test` runs 55 tests across three files, in about 300 milliseconds, with no database.

The five the spec requires, and where they are:

| Required case | Test name |
|---|---|
| Holidays removed from slots | `holidays are removed from the slots` |
| Multi-session topic spanning classes | `a multi-session topic spans consecutive classes and is numbered` |
| Quiz auto-moving when topics slip | `a quiz moves when its topics will not be finished in time` |
| Replanning leaving conducted sessions untouched | `a conducted class is never touched` |
| Deficit producing three valid options | `a deficit always produces three options` |

And the edge cases that were added because they are the ones that actually break:

- `a semester that crosses into the next year still works` — the day-walking loop across December into January.
- `a topic is never half-placed` — the overflow rule.
- `compress never takes a topic below its minimum`.
- `compress reports honestly when it cannot cover the whole deficit`.
- `an agreed makeup date becomes a usable class slot` — and that it lands in date order.
- `a makeup date in the past is not offered as a future slot`.
- `a cancelled class does not count as being behind`.

!NOTE After changing anything in `src/planner/`, run `npm test` before doing anything else. It takes a third of a second and it is the only thing standing between a small refactor and a silently wrong timetable.
