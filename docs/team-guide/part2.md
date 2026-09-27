# 2. How the system fits together

There are three pieces. It helps to know which piece is responsible when something goes wrong during testing.

|Piece|What it does|Where it runs|
|---|---|---|
|*The mobile app*|Every screen the teacher sees. Signs the teacher in, uploads photos and files, and calls the backend for everything else.|The phone (built with React Native and Expo)|
|*The backend*|The planner, attendance, grading and reports. Checks who is calling and only ever returns that teacher's own data.|Vercel: `https://ustaad-assist-backend.vercel.app`|
|*Supabase*|Three services: sign-in (accounts and passwords), the PostgreSQL database, and file storage for photos and course material.|Supabase's servers|

## What happens when the teacher signs in

- The app sends the email and password to *Supabase*, not to our backend. Our backend never sees a password.
- Supabase checks them and gives the app a *token*: a long piece of text that proves who the teacher is, signed so that it cannot be forged. It is valid for about an hour, and the app renews it automatically in the background.
- From then on, every request the app makes to our backend carries that token. The backend checks the signature, reads the teacher's ID from inside it, and uses that ID in every database query. A teacher can therefore never see another teacher's courses, even by guessing an ID.

## What happens when the teacher uploads a file

Photos of class lists, course outlines and course material are uploaded by the app *straight to Supabase Storage*, into a folder named after the teacher's own user ID. The app then sends only the file's path to the backend. Files never pass through the backend on the way in, which keeps uploads fast and keeps the backend simple.

## Tools for testing

Every backend answer has the same shape, `{ "success": ..., "data": ..., "message": ... }`, and when a screen shows an error its text comes from `message`.

|Tool|What it is for|
|---|---|
|*Swagger* at `/docs` on the backend URL|Every endpoint, with its fields explained. Click *Authorize*, paste a token, then *Try it out* and *Execute* on any endpoint.|
|*Postman*|The same requests, saved so they can be repeated. Needed to get a token outside the app (see below).|
|*The seeded demo course*|A realistic full semester already filled in: topics, students, a plan with conducted and cancelled classes, attendance, marks. Created by the backend's seed script for a chosen teacher account.|
|*Demo date* (`EXPO_PUBLIC_DEMO_TODAY`)|Makes the app pretend that "today" is a chosen date, so a semester that runs for four months can be shown in one sitting. Leave it empty in a real build.|

### Getting a token for Swagger or Postman

The app gets its token by itself. To call the backend by hand, sign in to Supabase directly:

- Method *POST*, URL `https://<project>.supabase.co/auth/v1/token?grant_type=password`
- Header `apikey` set to the project's *anon* (publishable) key
- Body, raw JSON: `{ "email": "...", "password": "..." }`

Copy `access_token` from the answer, without the quotes, and paste it into Swagger's *Authorize* box (without the word "Bearer") or into Postman's *Authorization* tab as a *Bearer Token*.

!WARN If Supabase answers `unsupported_grant_type`, the `?grant_type=password` part of the URL is missing or has an invisible space or new line after it. Type it by hand rather than pasting it.

## The words used in this guide

|Word|Meaning|
|---|---|
|Topic|One item of the syllabus, for example "Normalization". A topic can need several classes.|
|Slot|A real date on which the course can be taught: a class day that is not a holiday|
|Session|One planned class: a slot with a topic assigned to it. Its status is planned, conducted or cancelled.|
|Weightage|How much each kind of assessment counts towards the final total, adding up to 100%|
|Grade scale|The minimum percentage for each letter grade, set per course|
|Deficit|How many more classes the remaining topics need than the semester has left|
|Attendance threshold|The attendance percentage below which a student is flagged (75% unless the teacher changes it)|
