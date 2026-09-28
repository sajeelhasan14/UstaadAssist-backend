## 5. Algorithm Comparison — Core Requirement

At least two approaches are implemented for each major comparable problem and compared against each other on the same inputs.

|Component|Approach 1|Approach 2|
|---|---|---|
|A. Class slot assignment|Sequential greedy (teaching order)|Priority-first allocation|
|B. Deficit resolution: Drop|Greedy by priority|0/1 knapsack (dynamic programming)|
|B. Deficit resolution: Compress|Greedy by largest slack|Exhaustive search (optimality baseline)|
|C. Assessment placement|Linear scan|Binary search|
|F. Replanning after disruption|Full regeneration|Incremental freeze-and-rebuild|
|E. Class list extraction|Single OCR reading|Majority vote over six readings|

For each pair, the project determines which algorithm performs better, under what conditions, and why. The hypotheses the experiments will test:

- *Drop:* greedy and DP give identical results when topic sizes are uniform; DP is strictly better (fewer topics lost, fewer classes over-recovered) when sizes are uneven. Greedy is faster, O(n log n) against O(n × T), but both are well under a millisecond at semester scale, so DP is the right choice.
- *Compress:* greedy by slack matches the exhaustive optimum on every input, while the exhaustive search grows exponentially. This demonstrates when greedy is provably optimal.
- *Assessment placement:* both find the same dates; binary search wins as the slot list grows, and the difference is negligible at 30 to 40 slots.
- *Replanning:* incremental rebuild is the only approach that preserves taught classes, and it changes fewer future sessions than full regeneration.
- *Assignment:* sequential allocation is best when everything fits; priority-first covers more priority-weighted syllabus under a deficit, at the cost of teaching order.
- *Extraction:* voting reduces undetected misreads at roughly six times the processing time; a text-based department PDF is exact with either approach.

## 6. Input Size Experimentation

All algorithms are tested with datasets of increasing size. A real semester is the Small case; the larger datasets are generated synthetically with a fixed random seed, so every run is reproducible, to expose asymptotic behaviour.

|Dataset|Topics|Class slots|Assessments|Students (class list)|
|---|---|---|---|---|
|Small|20|40|5|20|
|Medium|100|200|15|60|
|Large|500|1,000|30|120|
|Very Large|1,000|2,000|50|200|

For deficit experiments, a deficit of 10% of the total classes needed is imposed by removing slots. For replanning experiments, a random future class is cancelled after a random number of classes have been conducted.

The following metrics are recorded, where applicable:

- *Execution time* (median of repeated runs)
- *Number of operations*: comparisons, DP table cells filled, binary-search probes
- *Total cost*: topics dropped and classes recovered beyond the deficit (Drop and Compress)
- *Total delay*: days each moved assessment is pushed back
- *Conflicts*: assessments left before their topics (must be zero)
- *Disruption*: future sessions whose date changes after a replan
- *Accuracy*: class list rows read correctly, and rows flagged for review
- *Memory usage*: DP table size, and heap usage measured by the runtime

## 7. Theoretical Complexity Analysis

Notation: *D* days in the semester, *S* class slots, *n* topics, *T* total classes the topics need (the sum of their loads), *A* assessments, *k* topics covered per assessment, *H* holidays, *R* OCR readings (six), *L* lines of recognised text, *m* students.

|Algorithm|Best|Average|Worst|Space|
|---|---|---|---|---|
|Slot generation (hash-set holidays)|O(D)|O(D)|O(D)|O(S + H)|
|A1 Sequential allocation|O(n log n + S)|O(n log n + S)|O(n log n + S)|O(n + S)|
|A2 Priority-first allocation|O(n log n + S)|O(n log n + S)|O(n log n + S)|O(n + S)|
|B1 Greedy drop|O(n log n)|O(n log n)|O(n log n)|O(n)|
|B2 Knapsack drop (DP)|O(n × T)|O(n × T)|O(n × T)|O(n × T)|
|B3 Greedy compress|O(n log n)|O(n log n)|O(n log n)|O(n)|
|B4 Exhaustive compress|O(2^n × n)|O(2^n × n)|O(2^n × n)|O(n)|
|Extend (makeup dates)|O(deficit)|O(D)|O(D)|O(deficit)|
|C1 Placement, linear scan|O(S + A × k)|O(S + A × (k + S))|O(S + A × (k + S))|O(n)|
|C2 Placement, binary search|O(S + A × (k + log S))|same|same|O(n)|
|F1 Full regeneration|O(D + n log n + S + A log S)|same|same|O(n + S)|
|F2 Incremental replan|O(D + n log n + S log S + A log S)|same|same|O(n + S)|
|E1 Single reading|O(L)|O(L)|O(L)|O(L)|
|E2 Majority vote|O(R × L)|O(R × L)|O(R × L)|O(R × L)|
|Duplicate seat check (hash map)|O(m)|O(m)|O(m)|O(m)|
|Schedule health|O(S)|O(S)|O(S)|O(1)|

*Why these forms.*

- *Slot generation* visits every calendar day exactly once, and each holiday test is a constant-time hash-set lookup instead of a scan of the holiday list, so the cost is linear in D regardless of H.
- *Allocation* is dominated by sorting the topics; after that a single pointer moves forward through the slots and never moves back, so each slot is visited at most once.
- *Knapsack* fills a table of (n + 1) × (T + 1) cells, each in constant time from two cells of the previous row; reading back the chosen topics adds O(n). There is no early exit, so best, average and worst cases coincide. The bound is *pseudo-polynomial*: polynomial in the value T rather than in the input's length. It is small in practice because T is a count of classes (about 30 to 40 per semester), and it is exponentially cheaper than the O(2^n) of trying every subset.
- *Linear scan placement* can stop at the first slot (best case) but must, on average, pass about half the slots; *binary search* halves the remaining range on every probe, so it takes about log2(S) probes in every case.
- *Incremental replan* adds an O(S log S) term over allocation because the report of what moved sorts each topic's old and new dates before pairing them.
- *Voting* parses each of the R readings once and tallies rows in a hash map, so it is linear in the total text. OCR recognition itself dominates the wall-clock time and is measured experimentally rather than analysed.

## 8. Application Requirement

The project is a working application in which every algorithm runs on real data:

- *Mobile application* (React Native with Expo) for the teacher: course setup, the teaching plan, attendance, marks, grading and reports.
- *REST service* (Node.js, Express and PostgreSQL, deployed on Vercel) that runs every algorithm on each request. Sign-in and file storage use Supabase.
- *Automated tests* (Node's built-in test runner) for every planner algorithm, including a check of the knapsack against exhaustive search on 500 random cases.

How the user inputs data and triggers each component in the application:

|Component|User action in the app|
|---|---|
|A. Slot assignment|Enter dates, class days and topic titles; tap *Generate my plan*|
|B. Deficit resolution|*Catch-up options* on the Plan tab: three computed options (Drop, Compress, Add makeup classes); tap *Choose*|
|C. Assessment placement|Create an assessment and choose its topics; any conflicting date is moved with a written reason|
|F. Replanning|Mark a class cancelled with a reason, or change a topic's classes needed; the "what moved" screen shows every change|
|E. Class list extraction|Photograph the class list or upload the department PDF; check the rows on the review screen|
|Schedule health|The warning on the course dashboard, e.g. "You are 1 week behind your plan"|

For algorithm comparison and performance analysis, the project provides a menu-driven command-line tool that calls the *same* planner functions the application uses, with no placeholders or hard-coded output:

```
=====================================
     USTAADASSIST PLANNER OPTIMIZER
=====================================
1. Class Slot Assignment
2. Deficit Resolution (Drop / Compress / Extend)
3. Assessment Placement
4. Replanning After Disruption
5. Class List Extraction
6. Schedule Health
7. Algorithm Comparison
8. Performance Analysis
```

## 9. Minimum Requirements Checklist

|Requirement|Where it is met|
|---|---|
|1. At least four optimization components|Five: A, B, C, E (adapted) and F, in Section 4|
|2. Two approaches per comparable problem|Six comparison pairs, Section 5|
|3. Algorithmic idea of each approach|Section 4, per component|
|4. Pseudocode|Section 4: allocation, knapsack, binary search, replanning, voting|
|5. Implementation in code|Pure planner functions in the backend, called by the application|
|6. Time complexity|Section 7, best, average and worst case|
|7. Space complexity|Section 7|
|8. Theoretical against experimental performance|Section 6 datasets and metrics, compared with Section 7|
|9. Advantages and limitations|Section 4 comparisons and Section 5 hypotheses|
|10. Most appropriate algorithm per scenario|Section 5|
|11. Working application integrating all algorithms|Section 8: mobile app, REST service and command-line optimizer|
