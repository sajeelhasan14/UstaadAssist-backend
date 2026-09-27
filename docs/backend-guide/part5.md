# 5 · The plumbing

> Four small files that every other file depends on: the response shape, the error handling, the database pool, and the server itself.

## `src/http.ts` — one response shape, everywhere

### The problem it solves

Without a convention, different endpoints end up answering differently. One returns `{ courses: [...] }`, another returns a bare array, a third returns `{ data: ..., error: null }`. The app then needs different unwrapping code per endpoint, and three developers building three screens each guess differently.

So *every* response from this backend, success or failure, has exactly three keys:

```
{ "success": true,  "data": { ... }, "message": null }
{ "success": false, "data": null,    "message": "Course not found" }
```

The app can therefore be written once: check `success`, use `data`, or show `message`.

### `ok()`

```
export function ok(res: Response, data: unknown, httpStatus = 200): void {
  res.status(httpStatus).json({ success: true, data, message: null });
}
```

- `data: unknown` — deliberately not `any`. `unknown` means "some value, I am not claiming to know what", and TypeScript will not let you accidentally use it as something specific. `any` would switch type checking off.
- `httpStatus = 200` — a default. Routes that create something pass `201` explicitly.
- `{ success: true, data, message: null }` — the bare `data` is shorthand for `data: data`.

!WARN Forgetting to call `ok()` is the classic bug and produces no error at all. The route finishes, Express never sends a response, and the phone sits spinning until it times out. This happened during development on `POST /courses`. Nothing catches it — no type error, no crash — so the habit to build is: every route path ends in either `ok()` or a `throw`.

### `AppError` — an error that knows its status code

```
export class AppError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AppError";
    this.status = status;
  }
}
```

A normal `Error` carries only a message. The error handler needs to know whether this is a 404, a 400 or a 500, and whether the message is safe to show the user. `AppError` carries both facts.

`extends Error` means it is still a real error — `throw` works, stack traces work, `instanceof Error` is true. `super(message)` calls the parent constructor to set the message.

The three shortcuts on top:

```
export const notFound = (what: string) => new AppError(404, `${what} not found`);
export const badRequest = (message: string) => new AppError(400, message);
export const unauthorized = (message = "Unauthorized") => new AppError(401, message);
```

So a service writes `throw notFound("Course")` and the caller gets `404 { "message": "Course not found" }`.

### `pathId()` — reading an id out of the URL safely

```
export function pathId(
  params: Record<string, string | string[] | undefined>,
  name: string,
): string {
  const value = params[name];
  if (typeof value === "string" && value !== "") return value;
  throw new AppError(400, `${name} is missing from the URL`);
}
```

It exists for two reasons.

*First, the types.* Express 5 types a route parameter as `string | string[]`, because a pattern could capture a name more than once. Ours never do, so this narrows it to `string` in one place instead of every route doing a cast.

*Second, and more importantly, typos.* `req.params` has no fixed set of keys, so TypeScript cannot catch this:

```
// route declares :courseId
const id = req.params.courseIdd;   // compiles. Is `undefined`.
```

That `undefined` then reaches the database as the literal text `"undefined"`, which produces a confusing error far from the mistake. This exact bug was hit twice while building the project. `pathId(req.params, "courseIdd")` instead throws *"courseIdd is missing from the URL"* — which names the mistake.

PAGEBREAK

## `src/middleware/error.ts` — the only place an error response is sent

Two functions, and the order they are mounted in `index.ts` is what makes them work.

### `notFoundHandler` — nothing matched the URL

```
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    success: false,
    data: null,
    message: `No route for ${req.method} ${req.path}`,
  });
}
```

Mounted *after every route*. Express tries each route in order; if none matched, control reaches here.

Without it, Express sends its own default 404, which is an HTML page. The app would call `response.json()` on a chunk of HTML and crash with something like *Unexpected token '<'*, which tells the mobile developer nothing about the real problem — a URL typo.

!NOTE The obvious objection: *"this is a phone app, the user cannot type a URL, so how can a route be missing?"* The user cannot — but the *developer* can. A screen with `/courses/3/attendence/summary` misspelled, or a route renamed on the backend, produces exactly this. Having it answer in JSON means the mobile developer sees `"No route for GET /courses/3/attendence/summary"` in their console and fixes it in ten seconds.

### `errorHandler` — something threw

```
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
```

*Four parameters.* This is how Express recognises an error handler. Remove `_next` and it becomes ordinary middleware that never runs on an error — and every failure hangs.

It handles four kinds of error, in order.

#### 1 · Our own errors

```
if (err instanceof AppError) {
  res.status(err.status).json({ success: false, data: null, message: err.message });
  return;
}
```

The status and message came from our code, so both are safe to send. This is the path for `notFound`, `badRequest` and `unauthorized`.

#### 2 · A body that is not valid JSON

```
if (err instanceof SyntaxError && (err as { type?: string }).type === "entity.parse.failed") {
  res.status(400).json({ success: false, data: null, message: "The request body is not valid JSON" });
  return;
}
```

`express.json()` throws this when it cannot parse the body. It is the *client's* mistake, so a 400 with a clear message is right.

This case was found by the smoke test: a malformed body was returning `500 Something went wrong`, which would have had the mobile team hunting a server bug over a stray comma.

#### 3 · Database errors that are really the caller's fault

```
function describeDatabaseError(code: string) {
  switch (code) {
    case "23505": return { status: 409, message: "That record already exists" };
    case "23503": return { status: 400, message: "That refers to something that does not exist" };
    case "23514": return { status: 400, message: "One of the values is not allowed" };
    case "22P02": return { status: 400, message: "One of the values is the wrong type" };
    default: return null;
  }
}
```

Those five-character codes are PostgreSQL's standard SQLSTATE codes: unique violation, foreign key violation, check violation, and bad input syntax. All four mean the request asked for something impossible, so a 500 would be misleading.

Anything not in that list falls through to the next case — an unexpected database error is treated as a real bug, not smoothed over.

#### 4 · Everything else

```
console.error("[error]", err);

res.status(500).json({ success: false, data: null, message: "Something went wrong" });
```

Two different audiences, deliberately:

- *The terminal* gets the real error with its stack trace, because that is what fixes the bug.
- *The client* gets a generic sentence, because an internal error message can leak table names, column names, file paths and query text. That is information an attacker uses.

### Why controllers never send errors themselves

Because Express 5 forwards anything an `async` route throws straight here. A route only describes success:

```
router.get("/:courseId", requireAuth, async (req, res) => {
  ok(res, await getCourse(pathId(req.params, "courseId"), req.auth!.userId));
});
```

One line. No `try`, no `catch`, no `if (!course) return res.status(404)...`. Every failure — a bad id, a missing course, a dead database — lands in one function. Change the error format once and all thirty-plus endpoints change with it.

PAGEBREAK

## `src/db/pool.ts` — connections and transactions

### What a pool is, and why not a single connection

Opening a connection to PostgreSQL is expensive: a TCP handshake, TLS, then authentication. Doing it per request would add well over a hundred milliseconds to every call to a database in Mumbai.

A *pool* opens a handful of connections when the server starts and lends them out. A query borrows one, uses it, and returns it.

```
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
```

### The error listener that stops the process dying

```
pool.on("error", (err) => console.error("[db]", err));
```

This looks like a throwaway line. It is not.

A pooled connection can fail while sitting *idle* — the network drops, or Supabase restarts. The pool then emits an `'error'` event. In Node, an `'error'` event with *no listener* is not ignored: it is thrown as an uncaught exception and *the whole process exits*.

So without this one line, a brief network blip takes the entire server down. With it, the failure is logged, the pool discards the dead connection, and the next request gets a fresh one. Nothing else in the app notices.

!NOTE This was demonstrated directly while building: a Node script emitting `'error'` with no listener died instantly, and adding an empty listener kept it alive. The listener is what matters, not what it does.

### `transaction()` — all or nothing

#### The scenario

Creating a course does two things: insert the course, then insert its preloaded holidays. If the second one fails, you must not be left with a course that has no holidays — the teacher would open the setup screen, see no public holidays, and generate a plan that schedules classes on Eid.

Either both happen or neither does.

#### Why it must be written by hand

PostgreSQL has transactions, with `begin` and `commit`. The problem is *which connection* the commands run on.

`pool.query()` borrows a connection, runs one statement, and gives it straight back. So:

```
await pool.query("begin");    // borrows connection A, starts a transaction, returns A
await pool.query("insert ..."); // might borrow connection B — outside the transaction!
await pool.query("commit");     // might borrow connection C — commits nothing
```

This was verified during development by printing the PostgreSQL backend process id: five `pool.query()` calls landed on *different* backends. A transaction spread across three connections is not a transaction.

So the transaction must run on *one borrowed connection*, held for its whole duration. That is what this function does.

```
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
```

Line by line:

- `pool.connect()` — borrow one connection and *keep* it. Unlike `pool.query()`, it is not returned automatically.
- `client.query("begin")` — start the transaction on that specific connection.
- `await fn(client)` — run the caller's work, *handing it the client*. Everything the caller does with that client is inside the transaction.
- `client.query("commit")` — make it permanent.
- `catch` — anything threw: `rollback` undoes every statement since `begin`, then `throw err` re-throws so the route still fails properly. Swallowing the error here would make a failed write look like a success.
- `finally` — `release()` gives the connection back to the pool. `finally` runs on success *and* failure, which is the point: a connection never returned is a connection permanently lost from the pool. Enough of those and the server stops responding.

#### Who gives the caller its `client`?

This confused during development and is worth stating plainly: *`transaction` does.* The caller writes a function that *accepts* a client, and `transaction` calls that function with the one it borrowed.

```
const course = await transaction(async (client) => {
//                                      ^^^^^^ transaction passes this in
  const created = await client.query("insert into course ...");
  await client.query("insert into holiday ...");
  return created.rows[0];
});
```

The caller never creates a client. It writes a recipe that says "given a client, here is what to do with it", and `transaction` supplies one, wraps it in `begin`/`commit`, and cleans up.

#### The `<T>` in the signature

```
transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>
```

Whatever the caller's function returns, `transaction` returns. Return a course row and you get a course row, fully typed. Without `<T>` the return type would have to be `any` and every call site would lose type checking.

!WARN Inside a transaction, use `client.query`, never `pool.query`. A stray `pool.query` borrows a *different* connection, runs outside the transaction, and is not rolled back. That is why the load helpers in `plan.service.ts` all take an optional client: `const run = client ?? pool;`.

PAGEBREAK

## `src/index.ts` — the server, and why the order matters

```
const app = express();

app.use(express.json());

app.get("/health", (_req, res) => { ok(res, { status: "ok" }); });

app.use("/auth", authRoutes);

app.use("/courses", planRoutes);
app.use("/courses", courseRoutes);

app.use("/sessions", sessionRoutes);
app.use("/topics", topicRoutes);
app.use("/assessments", assessmentRoutes);
app.use("/students", studentRoutes);
app.use("/materials", materialRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(PORT, () => { console.log(`Listening on http://localhost:${PORT}`); });
```

Express walks this list top to bottom for every request. Reading it in order *is* reading the request lifecycle.

### `app.use()` versus `app.get()`

- `app.get("/health", ...)` — runs only for `GET /health`.
- `app.use(express.json())` — runs for *every* request, whatever the method or path.
- `app.use("/courses", courseRoutes)` — runs for every request whose path starts with `/courses`, and strips that prefix before handing over. So inside `courses.ts`, `router.get("/")` means `GET /courses`.

### `express.json()` must be first

It reads the request body and parses it. A route that runs before it would find `req.body` as `undefined`.

### `/health` touches nothing

```
app.get("/health", (_req, res) => { ok(res, { status: "ok" }); });
```

Deliberately no database query. It answers "is the server process alive and able to respond". If it also queried the database, a database problem would make the server look dead when it is not — two different failures reporting as one.

### Two routers on `/courses`

```
app.use("/courses", planRoutes);
app.use("/courses", courseRoutes);
```

Express allows several routers on the same prefix; it tries them in order. The planner is mounted first so it reads as the most important part of the file, which it is.

It would work either way: Express matches the *full path*, so `courseRoutes`' plain `/:courseId` route does not swallow `/:courseId/plan/generate` — those are different paths. But putting the planner first makes the intent obvious to the next person.

### The two handlers at the bottom are the safety net

They must be *last*. `notFoundHandler` only makes sense once every route has had its chance, and `errorHandler` is registered last so Express knows it is the final destination for anything thrown anywhere above.

Move either one above the routes and it stops working — `notFoundHandler` would answer 404 for everything.

### `process.env.PORT ?? 4000`

```
const PORT = Number(process.env.PORT ?? 4000);
```

Use the port from `.env`, or 4000 if it is not set. `Number()` because environment variables are always strings and `app.listen("4000")` is not the same as `app.listen(4000)`.
