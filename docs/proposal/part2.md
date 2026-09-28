## 4. Required Problem Components

The project selects five optimization components, meeting the minimum of four. Components A, B, C and F follow the template directly. Component E is adapted to our domain as a multi-stage pipeline.

!NOTE *Component D (network route optimization) is not selected.* Semester planning has no physical network to route through. The one natural graph in the domain, prerequisites between topics, would require the teacher to enter every dependency by hand, which contradicts the system's design rule of asking for the minimum input. The five components below cover the domain's real optimization problems.

In every component, the algorithms are *pure functions*: data in, data out, with no database access. The application loads the data, calls the algorithm, and saves the result, which makes each algorithm independently testable and measurable.

### Component A — Class Slot Assignment (Resource Assignment)

A limited number of class slots must be assigned to competing topics. First the slots are generated: every date from start to end whose weekday is a class day and which is not a holiday. Then topics are assigned to slots. Each topic has:

- Topic ID and teaching order
- Classes needed (its load) and minimum classes
- Priority (High / Normal / Low)
- Assigned start and end date (the output)

Sample data: the planner's real output for a Database Systems course, Mondays and Wednesdays, 1 September to 18 December 2026. Defence Day (6 Sep) and Iqbal Day (9 Nov) are removed, leaving 30 slots for 30 needed classes.

|Topic|Order|Classes needed|Minimum|Priority|Planned start|Planned end|
|---|---|---|---|---|---|---|
|Introduction to Database Systems|1|1|1|Normal|2 Sep|2 Sep|
|The Relational Model|2|2|1|High|7 Sep|9 Sep|
|Entity Relationship Modelling|3|3|2|High|14 Sep|21 Sep|
|Relational Algebra|4|2|1|Normal|23 Sep|28 Sep|
|SQL: Queries and Joins|5|4|3|High|30 Sep|12 Oct|
|Normalization|8|3|2|High|28 Oct|4 Nov|
|Transactions and ACID|11|2|2|High|30 Nov|2 Dec|
|Recovery and Backup|13|1|1|Low|14 Dec|14 Dec|

*Approach A1: Sequential greedy (teaching order).* Walk the topics in teaching order with one pointer into the slot list; each topic takes the next *classes needed* slots. A topic is never split: one that does not fit whole goes to an overflow list.

```
ALLOCATE-SEQUENTIAL(slots, topics):
    sort topics by order_no
    next = 0
    for each topic t:
        if next + t.need > |slots|:  overflow.add(t);  continue
        for part = 1 .. t.need:
            sessions.add(slots[next], t, part);  next = next + 1
    return sessions, overflow
```

*Approach A2: Priority-first allocation.* When the slots cannot hold every topic, decide *which* topics fit by priority (high first, then normal, then low), and only then lay the chosen topics out in teaching order. This guarantees that the most important topics are scheduled, at the cost of possibly skipping a foundation topic of lower priority.

*Comparison.* Both run in O(n log n + S). A1 preserves the pedagogical order exactly and is optimal whenever everything fits, which is the normal case. A2 only differs under a deficit, where A1 overflows the *last* topics regardless of importance while A2 overflows the *least important*. Experiments measure the priority-weighted syllabus coverage of each under increasing deficits.

### Component B — Deficit Resolution (Scheduling Under Constraints)

More teaching is needed than the semester can hold:

```
deficit = classes the remaining topics need - class slots still available
```

Each remaining topic has a load (classes needed), a minimum, and a priority; the cost of the deficit is the teaching that must be given up. *Objective:* recover at least *deficit* classes while losing as little as possible. Rather than failing, the system computes three options and the teacher chooses one: *Drop* whole topics, *Compress* topics towards their minimum, or *Extend* with makeup days.

*Drop, Approach B1: Greedy by priority.* Sort topics least important first (later topics first among equals) and take topics until the deficit is covered. O(n log n).

*Drop, Approach B2: 0/1 knapsack by dynamic programming.* Each topic is either dropped entirely or kept (0/1), and frees a known number of classes (its weight). The cost of a set of dropped topics is compared lexicographically: first the number of high-priority topics dropped, then normal, then low (the fewest topics), then the fewest classes beyond the deficit, then a preference for later topics.

```
KNAPSACK-DROP(topics, deficit):
    T = total classes of all topics
    best[0][0] = zero cost;  best[0][s] = impossible for s > 0
    for i = 1 .. n:
        for s = 0 .. T:
            skip = best[i-1][s]
            drop = best[i-1][s - w(i)] + cost(topic i)   if s >= w(i)
            best[i][s] = cheaper of skip and drop;  took[i][s] = (drop chosen)
    s* = the cheapest best[n][s] with s >= deficit (smaller s breaks ties)
    walk back from (n, s*) through took[][] to list the dropped topics
```

*Why dynamic programming is justified here.* Greedy is not optimal for the 0/1 problem. Short by 3 classes, with low-priority topics of 3, 2 and 2 classes, greedy takes 2 + 2 (two topics, one class too many) while dropping the 3-class topic alone is exact. DP examines every useful combination through the table without enumerating 2^n subsets.

*Compress, Approach B3: Greedy by largest slack*, where slack = classes needed minus minimum. Taking classes from the topic with the most slack first is *provably optimal*, because every class removed has equal value and a topic may give up any amount up to its slack (the fractional structure). *Approach B4: exhaustive search* over reductions serves as the optimality baseline in experiments. *Extend* takes the earliest *deficit* dates that are not class days, Sundays or holidays.

### Component C — Assessment Placement (Contention / Slot Allocation)

Several assessments contend for class dates, each constrained to fall after the last class of every topic it covers. Factors: the assessment's scheduled date, the topics it covers, how far those topics have slipped, and the assessment type. *Objective:* zero conflicts (no assessment before its topics) and minimum delay (each conflicting assessment moves to the *first* valid class date, not an arbitrary later one). Every move carries a reason for the teacher, for example "Quiz 3 moved from 18 Sep to 25 Sep because Normalization will not be completed before 24 Sep."

One pass over the plan builds a hash map from each topic to its last teaching date. For each assessment, the latest of these among its topics is the constraint date *c*, and the question becomes: which is the first slot strictly after *c*?

*Approach C1: Linear scan* from the start of the slot list, O(S) per assessment.

*Approach C2: Binary search* on the date-ordered slot list, O(log S) per assessment:

```
FIRST-SLOT-AFTER(slots, c):
    low = 0;  high = |slots|
    while low < high:
        mid = floor((low + high) / 2)
        if slots[mid].date <= c:  low = mid + 1
        else:                     high = mid
    return slots[low] if low < |slots| else NONE
```

The slot list is sorted by construction, so binary search applies with no preprocessing. Both approaches return identical answers (verified exhaustively over every date of a semester); they differ only in cost as S grows.

### Component F — Replanning Under Disruption (Overall Resource Allocation)

The system's resources are the *remaining class slots* (the primary bottleneck), *makeup days* (a secondary resource, costly to the teacher), and the *slack between each topic's needed and minimum classes* (a reserve that Compress can draw on). A cancellation or a topic overrun changes the balance between them and triggers a replan. The replan must obey one invariant, *freeze the past*: a conducted class is never altered.

*Approach F1: Full regeneration.* Discard the plan and run slot generation and allocation from the semester start, as at setup.

*Approach F2: Incremental freeze-and-rebuild.* Keep every conducted session; compute each topic's remaining need (classes needed minus classes already given); generate slots only from today to the end date, keeping the course's week numbering; allocate the remaining work; re-run assessment placement; then compare the old and new plans topic by topic to report exactly what moved.

```
REPLAN(existing, topics, today):
    frozen = sessions with status = conducted
    remaining(t) = t.need - (frozen sessions of t)     for each topic t
    slots = GENERATE-SLOTS(today, end, class_days, holidays)
    sessions = frozen + ALLOCATE(slots, topics with remaining > 0)
    moves = PLACE-ASSESSMENTS(sessions, slots, assessments)
    changes = DIFF(old plan, new plan)   (per topic, dates paired in order)
```

*Bottlenecks and scaling.* Class slots are the binding constraint: each lost class raises the deficit by one, and once the deficit is positive the resolution cost (Component B) grows with n × T. Schedule health is monitored alongside:

```
behind_by_weeks = (classes planned up to today - classes conducted) / classes per week
```

*Comparison.* F1 is simpler, but it is not merely slower: it violates the invariant, because regenerating from the semester start reassigns topics to dates that have already been taught. F2 is correct and bounds its work to the future part of the semester. Experiments measure run time and *disruption*, the number of future sessions whose date changes.

### Component E (adapted) — Multi-Stage Pipeline: Class List Extraction

Students are never typed. The class list passes through stages: photograph, OCR text recognition, parsing of seat numbers (EB followed by 11 digits) and names, reconciliation, then a mandatory teacher review before anything is saved. The objective is the fewest misread rows at an acceptable processing time, since one misread seat number would silently attach a student's attendance and marks to the wrong person for the whole term.

*Approach E1: Single OCR reading*, parsed directly. Fastest.

*Approach E2: Majority vote over six readings* (three page-layout modes of the Tesseract OCR engine, each with and without automatic rotation). Rows are matched across readings by seat number and occurrence; for each row the name spelling most readings agree on wins, with spellings differing only by spaces counted as one vote; rows with weak agreement are flagged with low confidence for the review screen.

```
VOTE(readings):
    for each reading r, for each parsed row (seat, name) in r:
        key = seat + "#" + occurrence of seat in r
        tally[key].seen += 1;  tally[key].votes[name without spaces] += 1
    for each key: name = most-voted spelling;
                  confidence = high only if seen and agreement >= 2 and no rival spelling
```

On the review screen, duplicate seat numbers are found with a hash map in O(m) for m students, rather than by pairwise comparison in O(m^2).

*Comparison.* E2 costs roughly six times the OCR time of E1 in exchange for fewer undetected misreads. Experiments measure rows correct, rows flagged and time per page.
