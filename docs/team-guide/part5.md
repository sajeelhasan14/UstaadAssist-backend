# 5. The algorithms: what they are, where they run, and why

UstaadAssist is a project for a Design and Analysis of Algorithms course, and the planner is where that shows. Every part of it is a *pure function*: it takes data in and returns data out, and never reads or writes the database itself. The backend loads the data, calls the function, and saves the result. That is what makes each algorithm testable on its own, and every one below has automated tests.

In this chapter, *n* means the number of topics, *S* the number of class slots in the semester, *D* the number of days between the start and end dates, and *A* the number of assessments.

## 5.1 Summary

|File (in backend src/)|Algorithm|What it does for the teacher|Time|
|---|---|---|---|
|`planner/slots.ts`|Linear calendar walk with hash-set lookup|Finds every real class date, with holidays removed|O(D)|
|`planner/allocate.ts`|Single-pointer sequential allocation|Lays the topics across those dates in order|O(n log n + S)|
|`planner/assessments.ts`|Hash map of finish dates + *binary search*|Keeps every quiz after the topics it covers|O(S + A log S), plus the topics each quiz covers|
|`planner/replan.ts`|Freeze-and-rebuild replanning, with a per-topic diff|Rebuilds the future after a cancellation and lists what moved|O(S + n log n)|
|`planner/deficit.ts` (Drop)|*0/1 knapsack by dynamic programming*|Chooses the best set of topics to drop|O(n × T), T = classes the topics need|
|`planner/deficit.ts` (Compress)|Greedy by largest slack (provably optimal here)|Shortens topics without going below their minimum|O(n log n)|
|`planner/slots.ts` (Extend)|Greedy earliest free dates|Suggests makeup class dates|O(D)|
|`planner/health.ts`|Counting formula|"You are 1 week behind your plan"|O(S)|
|`extraction/classList.ts`|Majority voting across several OCR readings|Reads a class list photo reliably|linear in the text read|
|`grading/compute.ts`|Weighted sum, rounded once|Totals and letter grades|O(students × marks)|

## 5.2 Slot generation: which dates can have a class

The planner walks every date from the first day of the semester to the last. A date is kept when its weekday is one of the class days and it is not a holiday.

The holidays are first put into a *hash set* (a JavaScript `Set`). Checking "is this date a holiday?" in a set takes constant time, O(1), however many holidays there are, instead of scanning the holiday list for every day. The walk is therefore O(D): one step per calendar day. Each kept date also gets a week number (week 1 is the first seven days, and so on).

## 5.3 Topic allocation: which topic on which date

The topics are sorted by their teaching order (O(n log n)). Then one pointer moves forward through the list of slots: each topic takes the next *sessions needed* slots, and the pointer moves on. A topic needing three classes gets three consecutive class dates, numbered part 1, 2 and 3.

A topic is never split: if not enough slots remain for the whole topic, it goes into an *overflow* list, which is what the deficit screen later deals with. Each slot is visited at most once, so after sorting the work is O(S).

## 5.4 Assessment validation: a quiz never comes before its topics

- First, one pass over the plan records the *last date each topic is taught*, in a hash map (topic to date). O(S).
- For each assessment, the latest of those dates among the topics it covers is the date the assessment must come after.
- If the assessment is earlier, it must move to *the first class date after that day*.

That last step is now a *binary search*. The slots are already in date order, so there is no need to check them one by one from the start. Look at the middle slot: if it is on or before the date, the answer can only be to its right; otherwise it may be the answer, so keep it and look to its left. Each step throws away half of what is left, so a semester of S slots takes about log2(S) steps instead of up to S.

```
firstSlotAfter(slots, date):
    low = 0, high = number of slots
    while low < high:
        middle = (low + high) / 2, rounded down
        if slots[middle].date <= date:  low = middle + 1
        else:                           high = middle
    return slots[low] if low is inside the list, otherwise "none"
```

A reason is written for the teacher every time something moves, for example "Quiz 3 moved from 18 Sep to 25 Sep because Normalization will not be completed before 24 Sep."

!NOTE Why binary search here, when a semester only has about 40 class dates? The speed-up is small at this size. The point is that the list is *already sorted*, and a sorted list should be searched by halving. The tests check that it always returns exactly what a plain left-to-right search returns, for every date across a whole semester.

## 5.5 Replanning: freeze the past, rebuild the future

When a class is cancelled, or a topic's length changes, the planner does not start from scratch:

- Classes already *conducted* are never touched.
- Only the teaching still owed is worked out: for each topic, its sessions needed minus the classes already given to it.
- Slots are generated again *from today onward*, keeping the course's own week numbers, and the remaining topics are allocated into them (5.3).
- Assessment validation (5.4) runs again.

Then the planner *compares the old plan with the new one*, topic by topic: the old dates of a topic are paired with its new dates in order, and each pair that differs becomes one line on the "what moved" page. A cancelled class is paired with the class that replaces it, so the teacher reads "Joins moved from 14 Sep to 21 Sep" rather than a mysterious new class.

## 5.6 Deficit resolution: three ways to recover

When the topics still to teach need more classes than the semester has left:

```
deficit = classes the remaining topics need - class slots still available
```

If the deficit is above zero, the planner does not report an error. It calculates three options.

### Drop: the 0/1 knapsack problem, solved by dynamic programming

*The problem.* Choose some remaining topics to drop so that together they free at least *deficit* classes, while losing as little as possible. Each topic is either dropped completely or kept completely ("0/1"), and each frees a known number of classes (its "weight"). This is the classic *0/1 knapsack* problem.

*What counts as losing as little as possible*, in this order:

- never drop a high-priority topic if lower-priority topics can cover the deficit, and the same for normal priority;
- then drop as few topics as possible;
- then free as few extra classes as possible (the closest to exactly the deficit);
- then prefer topics later in the course, because earlier topics tend to be foundations.

*Why the obvious approach fails.* The simple, *greedy* approach takes the least important topic, then the next, until the deficit is covered, and never reconsiders. Suppose the course is 3 classes short, with three low-priority topics:

|Topic|Classes it needs|
|---|---|
|Topic 3|3|
|Topic 4|2|
|Topic 5|2|

Greedy takes Topic 5 (2 classes), then Topic 4 (2 more): *two topics dropped, and 4 classes freed when 3 were needed*. Dropping Topic 3 alone frees exactly 3 and loses only one topic. Greedy cannot find that, because it committed to Topic 5 at the first step. The app used to behave exactly like this; it now uses dynamic programming.

*Dynamic programming* means solving small versions of the problem first, storing their answers in a table, and building the full answer from the stored ones, instead of committing to one choice at a time. The table here is:

```
best[i][s] = the cheapest way to free EXACTLY s classes
             using only the first i topics   (or "impossible")
```

Every cell has just two choices for topic i: skip it, or drop it on top of the best way to free the other s - weight classes:

```
best[i][s] = the better of   best[i-1][s]                        (skip topic i)
                             best[i-1][s - weight(i)] + topic i  (drop topic i)
```

The first row is simple: with no topics, only "free 0 classes" is possible, and it costs nothing. The table is filled row by row. The answer is the cheapest cell in the last row whose s is at least the deficit. A second table remembers, for each cell, whether topic i was dropped, so the chosen topics can be read back by walking up the table from the answer.

For the example above, the last row finds that s = 3 is reachable by dropping only Topic 3 (one topic), while s = 4 needs two topics, so it chooses Topic 3.

*Cost.* The table has (n + 1) rows and (T + 1) columns, where T is the total number of classes the remaining topics need, and each cell takes constant time: *O(n × T)* time and memory. Trying every combination of topics instead would take O(2^n): about a million combinations for 20 topics, compared with a few thousand table cells.

*How we know it is right.* Besides tests for the example above, for priorities, and for the tie-breaks, one test builds 500 random small courses, finds the best answer by trying every possible combination of topics, and checks that the dynamic programming finds an equally good one every time.

### Compress: greedy, and here greedy is provably optimal

Compress shortens topics that currently take more classes than their minimum. Each topic's *slack* is its sessions needed minus its minimum sessions. The planner sorts topics by slack, largest first, and takes classes from each until the deficit is covered, never going below a minimum.

Greedy *is* optimal here, unlike in Drop. Every class removed is worth the same, one class, and a topic can give up any number of classes up to its slack. So taking from the topic with the most slack first always recovers the most classes while touching the fewest topics, and no other choice can do better. This contrast is worth knowing: greedy works when choices can be taken *partially* and are all worth the same (like the fractional knapsack), and fails when each choice is *all or nothing* (the 0/1 knapsack).

### Extend: makeup classes

The planner walks forward from today and collects the first *deficit* dates that are not normal class days, not Sundays, and not holidays. The earliest dates are chosen because a makeup class is most useful before the topics that need it. This is O(D) in the worst case.

The teacher picks one option. It is applied (topics dropped, topics shortened, or makeup dates added as class slots), and the planner runs again.

## 5.7 Schedule health

```
behind_by_weeks = (classes planned up to today - classes conducted) / classes per week
```

Cancelled classes are left out of "planned up to today", because a cancelled class was never an opportunity to teach. The result, rounded to one decimal place, becomes the warning on the Dashboard tab.

## 5.8 Reading a class list photo: voting between readings

A single OCR reading of a phone photo makes mistakes. So the backend reads the photo six ways (the Tesseract OCR engine in three page-layout modes, each with and without automatic rotation), parses the roll numbers and names from each reading, and lets the readings *vote*:

- Rows are matched between readings by roll number (and by how many times that number appeared, so a roll number genuinely printed twice stays two rows).
- For each row, the spelling of the name that most readings agree on wins. OCR often drops a space between words but almost never adds one, so spellings that differ only by spaces count as the same vote.
- A row only a few readings saw, or on whose name the readings disagree, gets a *low confidence*, and the review page highlights it.

A department PDF is read from its text layer instead, which is exact. Either way, the teacher's review is the final word (4.8).

## 5.9 Results: one calculation for the screen and the PDF

For every student: the marks in each component (quizzes, assignments, midterm, final, participation) are summed and turned into a percentage of that component's total, then combined using the teacher's weightage, and the letter grade is the highest band whose minimum the student reaches. Two rules keep it honest:

- *Round once, at the end.* Rounding each component first would add up small errors.
- *A missing mark is not a zero.* It is reported as missing and the result is shown as provisional; only a student marked absent scores a real zero.

The Results & grades page and the result sheet PDF call this same function, so they can never disagree.
