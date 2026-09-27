# 1. What UstaadAssist is, and why it exists

> A phone app that plans a university teacher's whole semester for one course, and keeps that plan correct as real life gets in the way.

The teacher sets a course up once: its name, the semester dates, the days it is taught, and the list of topics. From that, UstaadAssist *builds the teaching timetable itself*: which topic is taught on which date, week by week, skipping public holidays. When a class is cancelled or a topic takes longer than expected, the app *rebuilds the rest of the semester on its own* and shows the teacher exactly what moved.

Around that plan, the app handles the teacher's daily work: taking attendance, entering marks, calculating weighted totals and letter grades, keeping course material, and producing the three documents a teacher is asked for at the end of a term (a result sheet, an attendance report and a course delivery report).

## The problem: teachers are the user nobody builds for

Look at the software a university already has. Student portals and learning platforms such as Moodle or Google Classroom serve *students*. ERP and admissions systems serve *the administration*. Timetabling serves *the department*, and result systems serve *the examination office*. Every one of these asks the teacher to *feed it* data. None of them helps the teacher *do the job*: decide what to teach on which day, notice when the course is falling behind, and recover from it before the final exam.

So in practice a teacher still runs the semester from a paper register, an Excel sheet for marks, a course outline written once in week one and never updated, and memory. That works until the semester stops going to plan, which it always does.

## What actually goes wrong in a semester

- *Classes are lost.* A public holiday, a strike, a university event, the teacher is ill, a class is cancelled at short notice. Each lost class pushes every later topic back, but the written outline still shows the old dates.
- *Topics overrun.* "Normalization" was planned for two classes and needed three. The teacher now has to work out, by hand, what still fits.
- *Quizzes fall before their topics.* A quiz dated in week one of the plan is still on that date after the topics it covers have slipped two weeks. Students are tested on material they have not been taught.
- *Nobody notices the course is behind until it is too late.* By the time the teacher sees that three topics will not fit, the options for recovering are few.
- *End-of-term paperwork is assembled by hand.* Attendance percentages, the list of students below the attendance threshold, weighted totals, letter grades, and a summary of every class taught are copied between registers and spreadsheets, where mistakes creep in.

## What UstaadAssist does differently

UstaadAssist is *not* a record-keeping app where the teacher types everything in and gets the same thing back. Its core is a *planner*: a set of algorithms that produce a plan, check it, and repair it. From semester dates, class days and topic titles it works out every real class date and what is taught on each. It keeps every quiz after the topics it covers. When a class is cancelled it rebuilds the rest of the semester and lists what moved. It notices when the course is behind, and when time runs out it offers three calculated ways to recover. From marks alone it produces weighted totals, grades and the result sheet.

## The rule behind every screen: minimum input

A teacher will not type for forty minutes before seeing anything useful. So the app follows one rule everywhere:

!NOTE *Ask for the minimum, generate a draft, let the teacher correct it.*

- Topics are typed as one block of text, *one topic per line*. There is no "add topic" form to repeat twenty times. A course outline can also be photographed or uploaded instead.
- Only the topic *title* is required. How many classes each topic needs, its minimum, and its priority all start at sensible defaults (1, 1, normal) and are corrected after the teacher has seen the plan.
- Students are *never typed*. The teacher photographs the printed class list, or uploads the PDF the department already sent, and the app reads roll numbers and names from it. The teacher then checks the result on a review screen before anything is saved.
- Public holidays are *already filled in*. The teacher only switches off the ones their university does not observe.
- Attendance starts with *everyone present*. The teacher taps only the students who are absent.
- Marks are entered on a *number keypad* that moves to the next student automatically.

## How it helps the teacher, in one table

|Task|Without UstaadAssist|With UstaadAssist|
|---|---|---|
|Planning the semester|Written by hand in week one, never updated|Generated in seconds from dates and topic titles|
|A class is cancelled|Re-plan every later date by hand, or not at all|Tap "Mark cancelled"; the rest of the semester is rebuilt|
|A topic overruns|Guess what still fits|Change "classes needed"; the plan and quiz dates follow|
|Quiz dates|Easy to leave a quiz before its topics|Never allowed: the quiz is moved and the reason shown|
|Falling behind|Noticed near the end|"You are 1 week behind your plan" on the home screen|
|Running out of time|Cut topics by instinct|Three calculated options, each saying how much it recovers|
|Class list|Typed student by student|Photographed or uploaded, then checked|
|Attendance|Paper register, percentages by hand|Tap absentees; percentages and the below-threshold list are automatic|
|Grades|Spreadsheet formulas|Weighted totals and letter grades from the teacher's own weightage and grade scale|
|End-of-term documents|Assembled by hand|Result sheet, attendance report and course delivery report as PDFs|
