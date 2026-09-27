## 4.7 Students tab: adding the class list

*What it is for.* Getting every enrolled student into the course *without typing them*.

While the course has no students, the *Student Roster* page offers three ways in:

- *Capture Class List*: opens the camera. Photograph the printed class list; for several pages, take one photo per page. A photo takes up to about thirty seconds to read. Straight, flat and well-lit pages read best.
- *Import file*: choose the PDF the department sent (or an image). A department PDF is read *exactly*, in about a second.
- *Paste list*: the fallback. One student per line, roll number then full name, separated by a comma or a tab.

Whichever way is used, nothing is saved yet. The rows go to the review page.

## 4.8 Review class list (mandatory)

*What it is for.* A misread roll number would silently attach one student's attendance and marks to the wrong person for the whole semester. So the rows read from a photo or file are only a *draft*, and the teacher confirms them.

*What you see.* An editable table of *Roll no* and *Full name*. Rows are marked when:

- the roll number is missing, or the name is missing;
- the same roll number appears twice (flagged, never merged: merging would lose a student);
- the reading is doubtful, for example the photo was blurred there (highlighted as a warning to double-check).

Missing values and duplicates must be fixed before saving. A doubtful row can be saved once the teacher has looked at it.

*What to do.* Correct any cell, delete wrong rows, *Add a row* by hand for anyone missed, and *Capture another page* to append the next page of the list. Then *Review and add* saves the students.

*What to test.* Photograph a real class list: seat numbers (EB followed by 11 digits on the Computer Science sheet) should match the paper. Type a duplicate roll number and check that saving is blocked. Import the same list twice: existing students are matched by roll number, not added again.

## 4.9 Student list and student profile

*What it is for.* Seeing who is enrolled and who is at risk.

*What you see.* All enrolled students with their attendance percentage; students below the attendance threshold are highlighted. A search box finds a student by name or roll number.

Tapping a student opens the *Student Profile*: their attendance class by class, and their marks in every assessment. *Remove from this course* takes the student off this course's list; their record is kept.

## 4.10 Attendance

*What it is for.* Taking the roll in a few taps, and knowing who is below the threshold.

*How to open it.* *Take attendance* on the Dashboard tab, or on a class in the Plan tab. If several classes are waiting, the page first asks the teacher to *Choose a class*.

*What to do.* Every student starts as *Present*. Tap a student's row to mark them *Absent*; tap again to undo. Then *Submit attendance*. Submitting also records the class as conducted. Opening a class that already has attendance shows "Already recorded — submitting again replaces it", so mistakes can be corrected.

*See summary* shows each student's percentage, the class average, and an *Action required / Exam eligibility warning* list of students below the threshold. Before any class has been conducted, it explains that there is nothing to average yet. *Download signed PDF roster* produces the attendance report.

*What to test.* Mark two students absent in one class and check both their percentages. Edit that attendance and check the percentages update. Check that the threshold list matches the threshold set in course settings.

## 4.11 Assessment tab

*What it is for.* Every quiz, assignment, midterm, final and participation mark, and the grading that turns them into a result.

*What you see.* The assessments with their status: *scheduled* (a date is set), *unscheduled* (no date yet), *needs marks* (the date has passed and marks are missing), and *graded* (every student has a mark). A *Grading Criteria* card shows the weightage, and *Results & grades* opens the results.

### Create an assessment

Choose the *type*, a *date* (or *Set later*), the *total marks*, and the *topics it covers*. If the chosen date falls before those topics are taught, a suggestion appears at once, for example "These topics are taught until 24 Sep. Move to 25 Sep?", with a *Move* button. The backend enforces the same rule on every replan: the planner never leaves an assessment before its topics.

### Enter marks

One student at a time, with a *number keypad*. Type the score and the page moves to the *Next student* automatically. Each student can be:

- *Mark entered*: a score.
- *Marked absent*: counts as 0. The student really did not take it.
- *Not entered yet* (*Leave blank*): no mark yet. This is *not* treated as zero; the result is shown as provisional until it is entered.

*Discard* leaves without saving; saving asks for confirmation.

### Grading criteria

- *Component weightage*: how much quizzes, assignments, midterm, final and participation count. It must total exactly 100%.
- *Grade bands*: the minimum percentage for each letter grade. A student gets the highest grade whose minimum they reach. It starts from a standard scale (A from 85%, A- from 80%, B+ from 75% and so on) that the teacher can change or extend with *+ Add grade*, because grading differs between universities.

### Results & grades

Each student's weighted total and letter grade, with the *Class Average* and *Highest* at the top and a search box. A student with any mark still missing is labelled *Provisional*. *Result sheet (PDF)* produces the result document. These numbers come from the same calculation as the PDF, so the screen and the document can never disagree.

*What to test.* Set weightage that does not total 100 and check it is refused. Enter marks, leave one blank, and check that student shows as provisional rather than as a low grade. Mark one absent and check it counts as zero.

## 4.12 Material tab

*What it is for.* Keeping slides, notes, assignments and papers with the course, organised by topic.

*What you see.* Folders, one per topic, and filters such as *All Files* and *Slides*, with a search box.

*What to do.* *Upload file*: pick the file (PDF, PPTX, DOCX, ZIP, up to 50 MB), give it a title, and choose the *topic*, which sets the folder. Material can also be attached from a class in the Plan tab.

## 4.13 Reports

*What it is for.* The three documents a teacher is asked for, produced from data the app already has.

|Report|What it contains|
|---|---|
|*Result Sheet*|Course, code, semester, teacher and department; every student's roll number, name, total per component, weighted total and grade; class summary (number of students, average, highest, lowest, grade distribution, pass count); generation date and a signature line|
|*Attendance Report*|Class-by-class attendance for every student, their percentages, and the students below the threshold|
|*Course Delivery Report*|Every class, what it covered, and why any class was cancelled|

*What to do.* Open *Reports* from the *More & Settings* page, preview a report, and share or save it as a PDF.

*What to test.* The result sheet's totals match the *Results & grades* page exactly. The course delivery report shows the cancel reasons that were typed on the Plan tab.

## 4.14 Course settings

- *Edit course info* (name, code, semester, dates) and *Class Days*. Changing the dates or class days rebuilds the plan, adding any public holidays the new dates cover.
- *Holidays & Off Days*: each public holiday switched on or off. To skip one ordinary class day, cancel that class from the Plan tab instead.
- *Attendance threshold*: a slider, 75% by default. *Save Changes* saves everything.
- The *More & Settings* page (the profile) holds the teacher's name and email, and shortcuts to *Course Material*, *Reports*, *Switch course*, *Clone Semester* and *Sign Out*.
