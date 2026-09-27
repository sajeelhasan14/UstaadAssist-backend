# 6. Showing it to a teacher, and testing it

## 6.1 A ten-minute demonstration

This order tells the story the way a teacher lives it: set up in two minutes, then watch the app keep the plan correct when the semester goes wrong. Use a fresh course for steps 1 to 4, and the seeded demo course (with the demo date set) for steps 5 to 9.

- *1. The problem (1 minute).* Ask the teacher how they plan a semester and what happens to the plan when classes are lost. Most will describe a written outline that stops matching reality within weeks.
- *2. Setup (2 minutes).* Create a course: name, dates, two class days. Paste ten topic titles, one per line. Show the holidays already filled in. Tap *Generate my plan*.
- *3. The plan.* Show the week-by-week plan. Point out that no class falls on a holiday, and that a topic needing two classes takes two consecutive class dates.
- *4. The class list.* Photograph a printed class list, or import the department PDF. Show the review page, and a highlighted row the teacher has to check.
- *5. Home.* Open the seeded course. Show today's class, the four numbers, and the "behind your plan" warning.
- *6. A cancelled class.* On the Plan tab, cancel a class with the reason "Campus closed". Show the "what moved" page: past classes locked, topics shifted, and a quiz moved with its written reason.
- *7. Running out of time.* Raise a topic's classes needed until the course no longer fits. Open the catch-up options and explain the three cards. Choose one and show the rebuilt plan.
- *8. Attendance and marks.* Take attendance by tapping two absentees. Enter marks for a quiz with the keypad, leaving one blank, and show that student as provisional on *Results & grades*.
- *9. Reports.* Open the result sheet and the course delivery report, which lists the cancelled class and its reason.

!NOTE The line that lands with teachers: "You type your topic titles once. When a class is cancelled, you tap one button and the whole semester, including your quiz dates, is fixed for you."

## 6.2 Test checklist

Each row is one thing to confirm on a real phone, against the real backend.

|Page|Check|
|---|---|
|Sign in|Wrong password shows an error; the session survives closing the app|
|Create account|The full name appears on the profile and on reports|
|My courses|Active and Past tabs split courses by end date; a card opens its course|
|New course|Invalid dates or no class days are refused; blank topic lines are ignored|
|Outline import|A real outline PDF fills the topics in order; "Week 3-4" gives that topic two weeks of classes|
|Holidays|A holiday on a class day removes that date; switching it off restores it|
|Plan generated|No class on a holiday or a non-class day; multi-class topics are consecutive|
|Clone|Topics, weightage and grade scale copied; no students or assessments; new dates planned|
|Dashboard|Numbers change after marking a class conducted; the behind warning appears when classes are unmarked|
|Plan: cancel|Future topics shift; conducted classes do not change; the reason is saved|
|What moved|Every shift listed; a moved quiz shows its reason|
|Edit topics|Changing classes needed or priority rebuilds the plan|
|Catch-up options|Each card's numbers add up; Drop never cuts a higher-priority topic when lower ones suffice; applying an option rebuilds the plan|
|Class list photo|Seat numbers match the paper; doubtful rows highlighted|
|Review page|Missing values and duplicates block saving; add row, delete row and extra pages work|
|Students|Attendance percentages shown; below-threshold students highlighted; search works|
|Student profile|Attendance and marks shown; removing a student keeps their record|
|Attendance|Everyone starts present; editing replaces the old record; the summary matches|
|Create assessment|A date before its topics triggers the Move suggestion|
|Enter marks|The keypad moves to the next student; blank stays blank; absent counts as zero|
|Grading criteria|Weightage must total 100; a new grade band takes effect|
|Results & grades|Provisional shown for missing marks; the average matches the result sheet|
|Material|Upload, find in its topic folder, open, delete|
|Reports|All three generate; the result sheet matches the results screen|
|Course settings|Changing dates or class days offers to rebuild the plan; the threshold changes the flagged list|
|Sign out|Asks for confirmation; returns to sign in|

## 6.3 Worth knowing while testing

- *A photographed class list can take up to about thirty seconds* to read, because it is read six times and the readings vote. The department's PDF takes about a second.
- *The demo date.* With `EXPO_PUBLIC_DEMO_TODAY` set, the app and the backend both treat that date as today. Clear it before building the app for real use, or every day will look like that date.
- *Tokens expire after about an hour.* Inside the app this is invisible. In Swagger or Postman, a sudden 401 means it is time to sign in again and paste a new token.
- *When a screen shows something unexpected,* repeat the request in Swagger with the same account. A right answer there means the problem is in the app; a wrong one means the backend.
