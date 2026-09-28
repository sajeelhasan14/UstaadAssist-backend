## Central Question of the Project

There is no single best algorithm for every decision a semester forces on a university teacher. Laying topics onto class dates, recovering when classes are lost, placing quizzes after the material they test, and rebuilding the rest of the term after a disruption are different optimization problems with different structures. Our task is to design, implement, analyze and experimentally compare different algorithmic approaches to each of them, determine which approach is most suitable under different real conditions (a normal term, a term that has lost several classes, a very large synthetic course), and integrate the working algorithms into a functional application that demonstrates them end to end.

## 1. Problem Statement

A university teacher runs every course as a small scheduling system. A semester has a *fixed start and end date* and a *fixed set of weekly class days*. Removing public holidays leaves a limited number of real class dates, typically 25 to 40. Into those dates the teacher must fit a syllabus of 10 to 40 topics, each needing one or more classes, some more important than others. Around that timetable sit quizzes, assignments, a midterm and a final, each of which may only be held after the topics it covers have been taught, plus the attendance and marks of every enrolled student.

The system therefore involves many entities competing for one scarce resource, the class slot, under hard time constraints: the semester end date cannot move, and an assessment must never precede its topics. That makes it a natural fit for algorithmic optimization.

This project designs *UstaadAssist*, an adaptive semester planning system. Its core entities are the *course*, its *topics* (classes needed, minimum classes, priority), the *class slots* (real teaching dates), *public holidays*, *assessments* and the topics they cover, *makeup days*, and the *students* with their attendance and marks.

#### The project requires building a working application

The main objective is to apply Design and Analysis of Algorithms (DAA) concepts to a real-world optimization problem: implement multiple algorithmic solutions, analyze their computational complexity, experimentally compare their performance, and integrate these algorithms into a working application that a user can actually run and interact with. The algorithms are the graded core of the project, but they are demonstrated inside a real, usable system rather than as disconnected scripts: a mobile application for the teacher, backed by a REST service that runs every algorithm described here.

## 2. Scenario Description

A teacher runs one course for one semester, with the following entities and constraints:

- *A fixed, limited number of class slots*: the weekly class days between the start and end dates, minus public holidays. Every lost class permanently removes one.
- *Many competing topics*: 10 to 40 per course, all of which want slots, and which must be taught in a sensible order.
- *Topics of different sizes*: each needs a number of classes (its load), and has a minimum below which it cannot be meaningfully taught.
- *Different priority levels*: each topic is high, normal or low priority.
- *Deadlines*: the semester end date is fixed; each assessment has a scheduled date.
- *Dependent entities*: every assessment depends on the topics it covers and must fall after the last of them is taught.
- *Secondary resources*: makeup days (days the course is not normally taught, excluding Sundays and holidays) that can be added only at a cost to the teacher.
- *Limited overall capacity*: the total teaching the syllabus needs can exceed the slots available, producing a *deficit*.

Unexpected events are routine: classes are cancelled (campus closures, strikes, exam duty, illness), public holidays fall on class days, and topics overrun their planned number of classes. Each event can make the original plan *inefficient or infeasible*: topics no longer fit, and quizzes fall before their material. The system must help the teacher respond using algorithms, rebuilding the future of the plan without disturbing what has already been taught.

## 3. Main Objective

The system must answer the following algorithmic decision questions:

- *Assignment:* on which class date should each topic be taught?
- *Prioritization under scarcity:* when the remaining topics need more classes than remain, which topics should be dropped, which shortened, or which makeup dates added?
- *Constraint satisfaction:* on which date can each assessment be held so that it never precedes its topics, with the least delay?
- *Replanning:* after a disruption, how should the rest of the semester be rebuilt while never changing a class that has already been taught, and what exactly moved?
- *Monitoring:* how far behind its plan is the course?
- *Reliable input:* how can the class list be read from a phone photograph with the fewest misread rows?

Different algorithmic techniques are used to answer these questions rather than a single fixed method: greedy allocation, dynamic programming, binary search, hashing, incremental recomputation and majority voting. These techniques are integrated into a single working application in which the user can exercise each decision point.
