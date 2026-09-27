# 3. Using the app: signing in and setting up a course

This chapter and the next walk through every page in the order a teacher meets them. Each page lists *what it is for*, *what to do*, and *what to test*, so the same pages double as a test script and as a demonstration script for a teacher.

## 3.1 Sign in, create account, forgot password

*What it is for.* Getting into the app. Accounts are handled by Supabase.

*What to do.*

- *Create account:* full name, email and password, then *Create account*. If the Supabase project asks for email confirmation, the app says *Confirm your email*, and the teacher must click the link in that email before signing in.
- *Sign in* ("Welcome back"): email and password, then *Continue*.
- *Forgot password:* enter the email; Supabase sends a reset link.
- A *Google* sign-in button appears only when it has been switched on for the build.

*What to test.*

- A wrong password shows "Couldn't sign in", not a crash.
- An empty field shows "Missing details"; a short password shows "Password too short".
- Close and reopen the app: the teacher should still be signed in.
- The name typed at sign-up appears on the profile page and on the reports.

## 3.2 My courses

*What it is for.* The list of the teacher's courses. Every other page works inside one chosen course, so this is where the teacher picks it.

*What you see.* Two tabs, *Active* and *Past*. Each course card shows the course and its state; a course with no timetable yet says *Plan not generated*, and one whose end date has passed says *Semester ended*. A button starts a new course.

*What to test.* A new teacher sees an empty list with a way to create a course. Tapping a card opens that course on the Dashboard tab. Past courses appear under *Past* once their end date has gone by.

## 3.3 New course: step 1, course details

*What it is for.* The only information the planner truly needs about the course.

*What to do.* Enter the *course name* (for example "Database Systems"), optionally a *course code* (CS-301) and *semester term*, the *start date* and *end date*, and tap the *class days* (for example Mon and Wed). Then *Continue*.

*What to test.* The end date must be after the start date, and at least one class day must be chosen; otherwise the app shows "Check the details".

## 3.4 New course: step 2, your topics

*What it is for.* The syllabus, in teaching order.

*What to do.* Type or paste the topics into the box, *one per line*, in the order they are taught. Titles only: how many classes each needs is corrected after the plan is seen.

Instead of typing, *Import course outline* lets the teacher photograph the printed outline or choose its PDF. The app reads the topic titles from it and fills the box. If the outline says "Week 3-4: Normalization", that length is applied to the topic automatically.

*What to test.* Blank lines are ignored. An empty box shows "Check the topics". Import a real outline PDF: the topics should appear in order, and the teacher can still edit the text before continuing.

## 3.5 New course: step 3, holidays

*What it is for.* Removing days on which no class can happen.

*What you see.* Every Pakistani public holiday that falls inside the semester, already switched on. Each shows whether it *Falls on a class day* (it will cost a class) or is *No class that day* (it changes nothing).

*What to do.* Switch off any holiday the university does not observe, then *Generate my plan*.

*What to test.* A holiday on a class day really removes that date from the plan. Switching a holiday off puts the date back.

## 3.6 Plan generated

*What it is for.* The first result: the whole semester laid out week by week, seconds after setup.

*What you see.* The *Semester Plan*, grouped by week, with each topic on its dates. A topic that needs several classes appears on consecutive class dates as part 1, part 2 and so on. The page suggests the next step: *Add students to start taking attendance*.

*What to test.* No class falls on a holiday or on a day that is not a class day. Topics appear in the order they were typed. If the topics need more classes than the semester has, the page says so, and the catch-up options are available from the Plan tab.

## 3.7 Clone a course (new semester from an old one)

*What it is for.* Teaching the same course again next term without setting it up from scratch.

*What to do.* Choose the *source course*, give the *semester name* (for example "Spring 2027") and the new *start and end dates*, then *Clone and generate plan*. The class days are carried over.

*What gets copied:* the topics with their classes needed, minimums and priorities (each reset to not yet taught), the weightage (how much quizzes, assignments, midterm and final count), and the letter grade scale. Public holidays are worked out again for the new dates. *Students, assessments, attendance and marks stay with the old semester.*

*What to test.* The new course has the old topics and grading, a fresh plan on the new dates, and no students or assessments.

# 4. Using the app: running the semester

Inside a course, a bar at the bottom has five tabs: *Dashboard*, *Plan*, *Students*, *Assessment* and *Material*. Attendance, reports, course settings and the profile are opened from these tabs.

## 4.1 Dashboard tab (the course home)

*What it is for.* One look that answers "what do I teach today, and am I on track?"

*What you see, top to bottom.*

- *Today's class*, or the *next class* with its date, and a *Take attendance* button.
- *A warning banner* when the course is behind, in plain words, for example "You are 1 week behind your plan". It links to the catch-up options.
- *Four numbers:* Classes (conducted out of those planned up to today), Progress (percentage of the syllabus taught), Attendance (class average), and Assessments (how many are upcoming).
- *Upcoming this week*: the other classes in the next seven days.

*What to test.* Mark a class conducted and see *Classes* and *Progress* rise. Leave a past class unmarked and see the behind-schedule warning appear. Pull down to refresh.

## 4.2 Plan tab: the teaching plan

*What it is for.* The whole timetable, and the place where the teacher records what really happened.

*What you see.* The *Teaching Plan* in two views: *Calendar* (class days highlighted, with cancelled classes and quizzes marked) and *Week list*. Each class shows its topic, and conducted classes show *Session recorded*.

*What to do.* Tap a class to open its details. The menu offers *Edit topics*, *Catch-up options* and *Rebuild plan from today*.

## 4.3 A class's details: conducted or cancelled

This sheet is where most of the planner's work is triggered.

- *Take attendance*: opens the attendance page for this class. Everyone starts as present. Submitting attendance also marks the class conducted.
- *Mark conducted*: records that the class happened *without taking the roll*.
- *Mark cancelled*: asks *Why is this class cancelled?* with quick choices (Public holiday, Campus closed, I was unavailable, Exam duty) or a typed reason. *Cancel class and replan* rebuilds the rest of the semester and shows what moved. The reason is printed on the course report. *Keep this class* backs out.
- *Attach material*: upload slides or notes for this class's topic.

*What to test.* Cancel a future class: its topic moves to the next free class date, and every later topic shifts with it. Cancel a class and then check that conducted classes before it did not change.

## 4.4 Plan updated ("what moved")

*What it is for.* Showing the teacher, in plain sentences, what the replan changed, instead of silently changing the timetable.

*What you see.*

- *Past sessions (locked)*: conducted classes, which a replan never touches.
- *Schedule shifts*: each topic that moved, from which date to which date. If nothing moved, it says *Nothing had to move*.
- *Assessment rescheduled*: any quiz that had to move because its topics now finish later, with the reason, for example "Quiz 3 moved from 18 Sep to 25 Sep because Normalization will not be completed before 24 Sep."
- *No longer fits*: topics that no longer fit in the semester, with *See ways to catch up*.

## 4.5 Edit topics

*What it is for.* Correcting the defaults after seeing the plan.

*What you see.* The topics in teaching order with their status (*In progress*, *Taught*, *Dropped*), and totals: *Classes left*, what the *Topics need*, and what they need *At minimum*. Tapping a topic opens a sheet with:

- *Sessions needed*: the classes this topic normally takes.
- *Minimum sessions*: the fewest it could survive on (used by the Compress option).
- *Priority*: low, normal or high. Low-priority topics are the first candidates for dropping.

*Rebuild plan* applies the changes. *What to test:* raise a topic's sessions needed and see later topics shift and, if needed, a quiz move.

## 4.6 Catch-up options (the deficit screen)

*What it is for.* The moment the remaining topics need more classes than the semester has left. The app does not show an error. It works out three ways to recover and lets the teacher choose.

*What you see.* *Semester pacing deficit*: how many classes short the course is, and a bar of *Available vs needed*. Then three *Recovery strategy* cards, each saying how many classes it recovers and whether that is enough:

- *Drop topics*: remove whole topics, choosing the best combination (never a more important topic when less important ones are enough).
- *Compress topics*: teach some topics in fewer classes, never below their minimum.
- *Add makeup classes*: extra classes on days the course is not normally taught (not Sundays or holidays), with the suggested dates.

The app pre-selects the first option that fully solves the problem, checking Compress, then makeup classes, then Drop. The teacher taps *Choose*, the option is applied, the plan is rebuilt, and the "what moved" page follows. Classes already taught are never changed.

*What to test.* Set topics to need more classes than exist (for example, raise several topics' sessions needed), open the options, and check that each card's numbers add up. Apply each option on a copy of a course and check the new plan.

!NOTE This page is the best part of the app to demonstrate. How each option is calculated is explained in chapter 5.
