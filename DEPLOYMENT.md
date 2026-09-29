# Deploying to Vercel

The repo is ready to deploy. This file is the whole procedure, plus the things
that go wrong and how to tell.

---

## Before you start

You need a Vercel account (the free Hobby plan is enough) and the code pushed to
GitHub, GitLab or Bitbucket — or you can deploy straight from this folder with
the CLI.

**Do this first, before deploying.** It is the one step that is easy to skip and
causes a failure that looks like something else.

### Switch the database URL to transaction mode

Your current `DATABASE_URL` ends in port **5432**:

```
aws-0-ap-south-1.pooler.supabase.com:5432
```

That is Supabase's *session mode* — one connection held for the client's whole
lifetime. Correct for a long-running server, wrong for serverless.

For Vercel you need the same host and credentials with port **6543**, which is
*transaction mode* — the connection goes back to the pool after each transaction:

```
aws-0-ap-south-1.pooler.supabase.com:6543
```

Only the port changes. Everything else in the string stays the same.

**Why it matters:** on Vercel there is no single process. Each function instance
opens its own pool, and many instances can be alive at once. In session mode each
one holds a connection until the platform reaps the instance, and you run out of
connections fast — the symptom is `too many clients already`, appearing under
load rather than on the first request.

**Why it is safe:** transaction mode does not support session-level features —
`SET`, `LISTEN`, advisory locks, and named prepared statements. This backend uses
none of them. `transaction()` in [src/db/pool.ts](src/db/pool.ts) holds one
client for a `begin`/`commit` block, which transaction mode handles normally.

You can leave your local `.env` on 5432 if you prefer. Local and deployed do not
have to match.

---

## Deploy

### With the CLI, from this folder

```
npx vercel login
npx vercel            # a preview deployment, to check it works
npx vercel --prod     # the real one
```

The first run asks a few setup questions. Accept the defaults — `vercel.json`
already says how to build and route everything.

### Or from the dashboard

Import the repository at [vercel.com/new](https://vercel.com/new). Leave the
framework preset as "Other"; the build settings come from `vercel.json`.

---

## Set the environment variables

Nothing secret is in the repo — `.env` is gitignored, so it is never uploaded.
Add these in **Project → Settings → Environment Variables**, for both the
Production and Preview environments:

| Variable | Required by the server? | Notes |
|---|---|---|
| `DATABASE_URL` | **Yes** | the **6543** connection string |
| `SUPABASE_URL` | **Yes** | `https://<project>.supabase.co`. Public, safe |
| `SUPABASE_SERVICE_ROLE_KEY` | **No** | Only the scripts in `scripts/` use it, and those run on your machine. Leave it off Vercel — it grants full admin on the Supabase project, so fewer places is better |

If either required variable is missing the app cannot start, and **every** request
fails with `FUNCTION_INVOCATION_FAILED` — including `/health`, which touches
nothing. That is because both are read while modules are still loading, not inside
a request. `src/env.ts` checks for them first and names the missing ones in the
Vercel log.

**Do not set `PORT`.** Vercel manages it, and `src/index.ts` (the file that reads
`PORT`) is not used there at all.

Redeploy after adding them — variables are read at build and run time, and an
existing deployment will not pick them up.

---

## Verify it worked

Replace `<your-app>` with the URL Vercel gives you.

```
# 1. The server is alive. Touches no database.
curl https://<your-app>.vercel.app/health

# 2. The database is reachable. 401 is the RIGHT answer here — it proves the
#    route ran and the auth middleware rejected a missing token.
curl -i https://<your-app>.vercel.app/courses
```

Expected:

```
{"success":true,"data":{"status":"ok"},"message":null}
HTTP/2 401
{"success":false,"data":null,"message":"Missing Authorization: Bearer <token> header"}
```

Then a real request with a token:

```
TOKEN=$(curl -s "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: <anon key>" -H "Content-Type: application/json" \
  -d '{"email":"demo.teacher@ustaadassist.test","password":"UstaadAssist#Demo2026"}' \
  | python -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

curl -s https://<your-app>.vercel.app/auth/me -H "Authorization: Bearer $TOKEN"
```

You can also point the smoke test at the deployment:

```
BASE=https://<your-app>.vercel.app bash scripts/smoke.sh 8
```

---

## What does not run on Vercel

These are terminal scripts, not endpoints. They run on your machine, against the
same Supabase database:

| Command | Why it stays local |
|---|---|
| `psql ... -f migrations/*.sql` | Migrations are applied by hand, deliberately |
| `npm run seed` | A CLI script that builds the demo semester |
| `npm run create-demo-user` | An administrative job, done once |

So the order for a fresh database is: run the migrations locally, seed it
locally, *then* deploy. The deployment only serves requests.

---

## How the deployment is wired

Three files, and nothing else changed to make this work.

### `api/index.ts`

Vercel runs a function per request, so there is nothing to call `listen()` on —
it needs a handler of the shape `(req, res)`. An Express app already *is* that
shape, so exporting it is the entire adapter:

```ts
import app from "../src/app.ts";

export default app;
```

### The app / server split

| File | Job | Used by |
|---|---|---|
| `src/app.ts` | Builds and exports the app. No `listen`. | both |
| `src/index.ts` | Calls `listen`. | `npm run dev`, `npm start` |
| `api/index.ts` | Exports the app as a handler. | Vercel |

Local development is unchanged.

### `vercel.json`

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/api" }],
  "functions": {
    "api/index.ts": { "includeFiles": "node_modules/{tesseract.js,tesseract.js-core}/**" }
  }
}
```

`rewrites` sends every URL to the one function, and Express routes from there
exactly as it does locally.

`includeFiles` is the fix for a specific problem: `tesseract.js` (the OCR that
reads class-list photos) loads some of its files through a path built at runtime,
and Vercel's file tracer cannot see that, so those files get left out and photo
extraction fails. This forces them in.

### The pool knows it is serverless

[src/db/pool.ts](src/db/pool.ts) reads `process.env.VERCEL`, which Vercel sets in
every deployment:

```ts
max: isServerless ? 1 : 10,
idleTimeoutMillis: isServerless ? 10_000 : 30_000,
```

On a server, `max` is the whole process's budget. On serverless it is *per
instance*, and a single instance handles one request at a time — so one
connection each, and ten instances use ten connections rather than a hundred.

---

## When something is wrong

### Every request returns `FUNCTION_INVOCATION_FAILED`, even `/health`

The app is crashing while it loads, before Express handles anything — so this is
never a routing problem.

Almost always a missing environment variable. `DATABASE_URL` and `SUPABASE_URL`
are read at module load, so without them the app cannot start at all. Check the
Vercel log: `src/env.ts` prints which ones are missing.

Remember to **redeploy** after adding them. Adding a variable does not update a
deployment that already exists.

If the log instead says `ERR_MODULE_NOT_FOUND: Cannot find module
'/var/task/src/app.ts'`, see the next entry.

### `ERR_MODULE_NOT_FOUND` for a `.ts` file

Locally, Node runs the `.ts` files as they are. Vercel does not: it converts each
one to JavaScript first, so `src/app.ts` is deployed as `src/app.js`. Our imports
are written with `.ts` on the end (`import app from "../src/app.ts"`), and if
that text is copied across unchanged, Node looks for a file that is not there.

`"rewriteRelativeImportExtensions": true` in `tsconfig.json` is what prevents
this. It tells TypeScript to change `./x.ts` to `./x.js` in every relative import
while converting. **Do not remove it.** It has no effect on `npm run dev`, which
never reads `tsconfig.json`.

### `too many clients already`

`DATABASE_URL` is still on port 5432. Change it to 6543 and redeploy. This is the
failure the first section exists to prevent.

### Everything returns 404

`vercel.json` is missing or its `rewrites` did not apply, so Vercel is looking for
static files instead of calling the function. Confirm the file is committed.

### The first request each time takes a second or two

That is a cold start, and it is normal on serverless. The function is frozen after
a period of idleness, and the next request pays to start it plus build the OpenAPI
document and the pool.

**Before a demo or a viva, hit `/health` once to wake it up.** A two-second pause
on your first click is the kind of thing that looks like a bug when someone is
watching.

### A request fails but there is nothing useful in the response

By design — [src/middleware/error.ts](src/middleware/error.ts) sends a generic
message and logs the real error, so internal details never leak. The real error is
in **Vercel → your project → Logs**, which is where `console.error` output goes.

---

## Still outstanding

**CORS is not configured.** There is no CORS middleware anywhere in `src/`.

This does not matter for React Native on a phone or an emulator, because native
`fetch` does not enforce the same-origin policy. It *will* break any developer who
runs `expo start --web`, once the backend is on a public URL: every request fails
with a CORS error, which looks like the API being down.

Adding it means the `cors` package, which is outside the closed dependency list in
CLAUDE.md, so it needs a decision rather than a commit.

**Consider whether this should be public at all.** A deployed backend is reachable
by anyone who finds the URL. Every endpoint except `/health` requires a valid
Supabase token, and every query is scoped to the teacher in that token — so data
is protected.
