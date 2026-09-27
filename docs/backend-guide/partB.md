# 13 · Running it somewhere other than your laptop

> The repo is ready to deploy to Vercel. This chapter is why the three files that make that work exist, and the one trap that has nothing to do with Vercel at all. The step-by-step procedure is in `DEPLOYMENT.md`.

## Serverless is a different shape

A normal Node server starts once and runs forever. It calls `app.listen(4000)`, holds a pool of database connections, and answers request after request from the same process.

Vercel does not work that way. It runs a **function per request**. There is no long-lived process, nothing to call `listen()` on, and the function is frozen when idle and thawed when a request arrives.

That difference explains every change that was needed.

!NOTE Render, Railway and Fly run a normal long-lived process, and would have needed none of this — `app.listen()` works there unchanged. Vercel is a slightly awkward fit for an Express and Postgres API. It is still perfectly workable, and for a university project the free tier and the single deploy command are a fair trade.

## Change 1 — the app is separated from the server

Before, `src/index.ts` did two jobs: it built the app *and* started it. Those have to come apart, because Vercel wants the app without the starting.

| File | Job | Used by |
|---|---|---|
| `src/app.ts` | Builds and exports the app. No `listen`. | both |
| `src/index.ts` | Imports it and calls `listen`. | `npm run dev`, `npm start` |
| `api/index.ts` | Exports it as a handler. | Vercel |

`src/index.ts` is now eight lines:

```
import app from "./app.ts";

const PORT = Number(process.env.PORT ?? 4000);

app.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
  console.log(`Docs at      http://localhost:${PORT}/docs`);
});
```

And `api/index.ts` is shorter still:

```
import app from "../src/app.ts";

export default app;
```

That really is the whole adapter, and the reason is worth knowing: **an Express app is itself a function of `(req, res)`**. That is exactly the shape a serverless platform invokes. So Express needs no translation layer — it already looks like a handler.

Nothing inside `src/app.ts` knows or cares which of the two is running it.

### Proving the handler works

Type-checking cannot tell you that an export is a *working* handler. So it was tested by wrapping it in a bare Node HTTP server — essentially what Vercel does — and calling it:

```
api/index.ts invoked as a plain (req, res) handler:
  200  /health                {"success":true,"data":{"status":"ok"},"message":null}
  200  /openapi.json          {"openapi":"3.1.0","info":{"title":"UstaadAssist API"...
  200  /docs/                 <!DOCTYPE html>...
  401  /courses               {"success":false,"data":null,"message":"Missing Author...
  404  /nope                  {"success":false,"data":null,"message":"No route for G...
```

The `401` and the `404` matter as much as the successes: they prove the auth middleware and the not-found handler are both in the chain, not just that the server answered something.

PAGEBREAK

## Change 2 — the database URL, which is the real trap

This is the one that will catch you, and it is a database setting rather than a Vercel one.

The connection string ends in a port:

```
aws-0-ap-south-1.pooler.supabase.com:5432      <- session mode
aws-0-ap-south-1.pooler.supabase.com:6543      <- transaction mode
```

| Port | Mode | Holds a connection | Right for |
|---|---|---|---|
| 5432 | session | the client's whole lifetime | a long-running server |
| 6543 | transaction | until the transaction ends | serverless functions |

On a server, session mode is fine — one process, a handful of connections, held and reused all day.

On serverless it is wrong. Each function instance opens its own pool, many instances can be alive at once, and in session mode each one keeps its connection until the platform reaps the instance. You run out of connections, and the symptom is `too many clients already` — appearing under load rather than on the first request, which is what makes it confusing.

### Why transaction mode is safe here

Transaction mode gives up session-level features: `SET`, `LISTEN`, advisory locks, and named prepared statements. So the question is whether this codebase uses any of them.

It does not. And the one that looks like it might — `transaction()` in `src/db/pool.ts` — is fine: it borrows **one** client and holds it for the whole `begin`/`commit` block, which is precisely what transaction mode is built to support. A transaction keeps its connection for its duration either way.

Only the port changes. Host and credentials stay the same, and local and deployed do not have to match.

## Change 3 — the pool knows which one it is

```
const isServerless = process.env.VERCEL === "1" || process.env.VERCEL === "true";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: isServerless ? 1 : 10,
  idleTimeoutMillis: isServerless ? 10_000 : 30_000,
  connectionTimeoutMillis: 10_000,
});
```

Vercel sets `VERCEL=1` in every deployment, so the code can tell.

The reason `max` flips is that it means two different things in the two places:

- On a server, `max: 10` is the *whole process's* budget. Ten connections shared by every request.
- On serverless, `max` is **per instance**. A single instance handles one request at a time, so it only ever needs one connection — and `max: 10` across ten live instances would be a hundred connections for no benefit.

`idleTimeoutMillis` is shorter on serverless so an instance about to be frozen lets its connection go rather than holding it.

`connectionTimeoutMillis: 10_000` is new for both: fail in ten seconds with a clear error instead of hanging a request until the platform's own timeout kills it, which produces a much less informative failure.

## Change 4 — `vercel.json`

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/api" }],
  "functions": {
    "api/index.ts": { "includeFiles": "node_modules/swagger-ui-dist/**" }
  }
}
```

`rewrites` sends every URL to the one function. Express does all the routing from there, exactly as it does locally — Vercel is not routing to forty functions, it is routing everything to one and letting Express sort it out.

`includeFiles` fixes a specific and initially baffling problem. `swagger-ui-express` serves its CSS and JavaScript out of `node_modules/swagger-ui-dist`, through a path it builds at *runtime*. Vercel decides what to upload by tracing the imports it can see statically, so it cannot see that path and leaves those files behind. The result is that `/docs` returns `200`, loads, and renders as a **blank white page** — no error anywhere. This line forces the files in.

## What is different once it is deployed

### Environment variables come from the dashboard

There is no `--env-file` on Vercel, and `.env` is gitignored so it is never uploaded. The three values are set in *Project → Settings → Environment Variables*. The code only ever reads `process.env`, so nothing in it changes.

`PORT` is deliberately *not* set — Vercel manages it, and `src/index.ts`, the only file that reads it, is not used there at all.

### Module-level work runs once per cold start

Both the OpenAPI document and the connection pool are built at module level. On a server that means once, ever. On serverless it means once per cold start — so a warm function reuses them, and only the first request after an idle spell pays.

That is also why there is a cold start of a second or two at all.

!WARN Before a demo or a viva, call `/health` once to wake the function up. A two-second pause on your first click looks exactly like a bug when somebody is watching you.

### The scripts stay on your machine

| Command | Why it does not deploy |
|---|---|
| `psql ... -f migrations/*.sql` | Migrations are applied by hand, deliberately |
| `npm run seed` | A terminal script that builds the demo semester |
| `npm run create-demo-user` | An administrative job, done once |
| `npm run openapi` | Writes `docs/openapi.json` for the app team |

So for a fresh database the order is: migrate locally, seed locally, *then* deploy. The deployment only answers requests.

### Errors go to the Vercel log, not the response

Unchanged behaviour, but a different place to look. `src/middleware/error.ts` sends a generic message and logs the real error, so internal details never leak. On Vercel that `console.error` output is under *your project → Logs*.

## One thing still open

**There is no CORS middleware.** It does not matter for React Native on a device or an emulator, because native `fetch` does not enforce the same-origin policy. It *does* matter the moment a developer runs `expo start --web` against a public URL: every request fails with a CORS error, which looks like the API being down rather than a browser rule.

Fixing it means adding the `cors` package, which is outside the closed dependency list, so it is a decision rather than a commit.
