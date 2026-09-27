# 10 · The Swagger docs, and how the app team uses them

> `/docs` is the contract. It is generated from the code, so it cannot be out of date. This chapter explains how, and what the mobile team does with it.

## The problem this solves

Four people are building this. One backend, three on the app, in parallel. The app developers need to know, for every endpoint: what the URL is, what to send, what comes back, and what the failures look like.

The obvious solution is a document. The obvious problem with a document is that it goes stale the first time somebody renames a field and forgets to update it — and then three developers spend an afternoon debugging against a lie.

So there is no document. There is a *generated* one:

```
  src/openapi/schemas.ts     the shapes
  src/openapi/requests.ts    what each endpoint accepts
  src/openapi/contract.ts    the list of all 40 endpoints
            |
            +----> src/openapi/document.ts ----> GET /openapi.json   the spec
            |                                    GET /docs           Swagger UI
            |
            +----> src/middleware/validate.ts    request validation
            |
            +----> tests/contract.test.ts        checks it matches the routers
```

One definition, four consumers. There is no second place to edit, so the docs cannot disagree with the validation, and neither can disagree with the routes — a test compares them.

## What the app team gets

| URL | What it is |
|---|---|
| `http://localhost:4000/docs` | Swagger UI. Browsable, searchable, with a "Try it out" button |
| `http://localhost:4000/openapi.json` | The raw spec, for tooling |
| `docs/openapi.json` | The same spec committed to the repo |

Both URLs need **no token**. The team has to be able to read the contract before they can sign in.

### Trying a request from the browser

Swagger UI has a live "Try it out" button on every endpoint. To use it on a protected endpoint:

1. Get an access token — sign in through the app, or from a terminal:

```
curl -s "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: <anon key>" -H "Content-Type: application/json" \
  -d '{"email":"demo.teacher@ustaadassist.test","password":"UstaadAssist#Demo2026"}'
```

2. Click *Authorize* at the top of `/docs` and paste the `access_token`.
3. Every endpoint now works from the page.

`persistAuthorization` is switched on, so the token survives a page reload.

### Building screens before the endpoint exists

The committed spec can be served as a *mock server*, so the app can be built against realistic responses with the real backend switched off entirely. From the mobile repo:

```
npx @stoplight/prism-cli mock docs/openapi.json
```

That serves all 40 endpoints on port 4010, answering with the examples in the spec. Point the app's base URL at it, build every screen, and when the real endpoint lands, change one base URL.

!NOTE Nothing was installed in the backend for this. Prism is a mobile-side tool, run through `npx`, and the backend dependency list stays closed at six runtime packages.

PAGEBREAK

## How the spec is built

### `extendZodWithOpenApi`, once

```
// src/openapi/zod.ts
import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);

export { z };
```

This adds an `.openapi()` method to every Zod schema, for examples and descriptions. It must run *before* any schema is built, and exactly once — so it happens in its own tiny module and everything else imports `z` from here rather than from `"zod"`.

### A schema carries its own documentation

```
export const DateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be a date in YYYY-MM-DD form")
  .openapi({ example: "2026-09-01", description: "A calendar date, YYYY-MM-DD" });
```

That one definition produces three things: the regex that *validates* an incoming date, the `example` the Swagger UI shows, and the `description` the app developer reads. The error message in the `regex()` call is the message the API actually returns.

Naming a schema registers it as a reusable component:

```
export const Course = z.object({ ... }).openapi("Course");
```

So `Course` appears once under *Schemas* in the UI and every endpoint that returns a course points at it, rather than the same twenty fields being repeated forty times.

### The contract is a list, not forty hand-written blocks

```
export type EndpointDef = {
  method: HttpMethod;
  path: string;              // OpenAPI style: /courses/{courseId}/topics
  tag: string;
  summary: string;
  description?: string;
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
  response: z.ZodType;       // the shape of `data` in the envelope
  status?: number;
  errors?: number[];
  isPublic?: boolean;
};
```

And then one entry per endpoint:

```
{
  method: "post",
  path: "/courses/{courseId}/topics",
  tag: "Topics",
  summary: "Set the course topics from one block of text",
  description:
    "Send the whole textarea as `raw`, one topic per line. The server splits, trims " +
    "and drops blank lines. Only the title is needed ... NOTE: this REPLACES all topics.",
  params: R.CourseIdParam,
  body: R.CreateTopicsBody,
  response: list(S.Topic),
},
```

`document.ts` then loops over the whole list. There is no per-endpoint Swagger code anywhere.

### The envelope is applied automatically

Every endpoint's `response` is the shape of `data`, not the whole body. The generator wraps it:

```
const success = (data: z.ZodType) =>
  z.object({
    success: z.literal(true),
    data,
    message: z.null(),
  });
```

So the envelope is documented on all forty endpoints without any of them mentioning it, and it cannot be documented inconsistently.

### Error responses are derived, not written

```
function errorResponses(endpoint: EndpointDef) {
  const codes = new Set<number>([500]);

  if (!endpoint.isPublic) codes.add(401);
  if (endpoint.params)    codes.add(404);
  if (endpoint.body)      codes.add(400);
  for (const code of endpoint.errors ?? []) codes.add(code);
  ...
}
```

The rules are mechanical, so they are applied mechanically: anything with a token can 401, anything with an id in the URL can 404, anything with a body can 400, everything can 500. `errors: [503]` adds the specific ones — the two stubs and the deficit guard.

This means no endpoint can accidentally be documented as never failing.

PAGEBREAK

## Request validation, from the same definition

`src/middleware/validate.ts` is mounted **once** in `index.ts`, and it covers all forty endpoints.

```
app.use(express.json());
app.get("/health", ...);

const openApiDocument = buildDocument();
app.get("/openapi.json", ...);
app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument, { ... }));

app.use(validateAgainstContract);      // <- here

app.use("/auth", authRoutes);
...
```

The position is exactly right: *after* `express.json()`, so there is a body to inspect, and *before* the routers, so a malformed request never reaches a service.

### Matching a URL to a contract entry

The incoming URL is `/courses/8/topics`. The contract says `/courses/{courseId}/topics`. So each path is compiled to a regex once at startup:

```
function compile(path: string): RegExp {
  const pattern = path
    .split("/")
    .map((segment) => {
      if (segment.startsWith("{") && segment.endsWith("}")) return "([^/]+)";
      return segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    })
    .join("/");

  return new RegExp(`^${pattern}/?$`);
}
```

Two details that matter:

- `([^/]+)` for a parameter — one segment, not greedy across slashes, so `/courses/8/topics` cannot match `/courses/{courseId}`.
- The `.replace(...)` on literal segments escapes regex characters. Without it, a `.` in a path would act as "any character" and `/health` would match `/healthX`. There is a test for exactly that.

The compiled list is sorted so paths with *fewer* parameters are tried first:

```
const COMPILED = CONTRACT.map(...).sort((a, b) => a.paramCount - b.paramCount);
```

This is for a real collision: `POST /courses/{id}/students/import` has the same *shape* as `DELETE /courses/{id}/students/{studentId}`. The methods differ so they would not actually clash today, but ordering literal segments first means a future addition cannot introduce that bug quietly.

### The two deliberate limits

```
export function validateAgainstContract(req, _res, next) {
  const endpoint = findMatch(req.method, req.path);

  if (!endpoint) {
    next();      // not a documented path — let notFoundHandler answer it
    return;
  }

  if (endpoint.query) check(endpoint.query, req.query, "query string");
  if (endpoint.body)  check(endpoint.body, req.body ?? {}, "body");

  next();
}
```

*It validates but does not replace `req.body`.* Zod strips keys it does not know about, and silently dropping a field the app thought it sent would be worse than ignoring it. The services read what was actually sent.

*An unknown path passes straight through*, so a typo'd URL still gets the ordinary 404 rather than a confusing validation error. This middleware is not a gatekeeper — it only checks what the contract describes.

### The services keep their own checks

This is not duplication for its own sake. The two layers catch different things:

| Layer | Catches | Example message |
|---|---|---|
| Schema | Wrong *shape* | `type: Invalid option: expected one of "quiz", "assignment" ...` |
| Service | Wrong *meaning* | `min_sessions (3) cannot be more than sessions_needed (2)` |

A schema cannot know that the weightage must total 100, or that a mark cannot exceed an assessment's `total_marks`, because those depend on other values or on rows in the database. Those checks stay where they can see the data.

### What the app actually receives

Every one of these is a real response from the running server:

```
POST /courses          {"name":"X","start_date":"01-09-2026",...}
-> 400 {"success":false,"data":null,
        "message":"start_date: must be a date in YYYY-MM-DD form"}

POST /courses          {"name":"","class_days":["funday"],...}
-> 400 {"message":"name: name is required; class_days.0: Invalid option:
         expected one of \"mon\"|\"tue\"|\"wed\"|\"thu\"|\"fri\"|\"sat\"|\"sun\""}

PATCH /courses/8       {}
-> 400 {"message":"Nothing to update"}

PATCH /sessions/244    {"status":"cancelled"}
-> 400 {"message":"cancel_reason is required when cancelling a class"}

GET /courses/8/dashboard?today=tomorrow
-> 400 {"message":"today: must be a date in YYYY-MM-DD form"}
```

Every message names the field and the problem, in the same envelope as everything else. That is the difference between a mobile developer fixing something in ten seconds and spending an hour guessing.

PAGEBREAK

## The tests that keep the docs honest

`tests/contract.test.ts` adds 19 tests, and two of them are the important ones.

### "every mounted route is documented"

It reads the router source files and extracts the paths:

```
const pattern = /router\.(get|post|patch|put|delete)\(\s*"([^"]*)"/g;

for (const match of source.matchAll(pattern)) {
  const full = `${prefix}${match[2]}`
    .replace(/\/$/, "")
    .replace(/:([A-Za-z0-9_]+)/g, "{$1}");   // Express :id -> OpenAPI {id}

  found.add(`${match[1]} ${full}`);
}
```

Then compares that set against the contract, in both directions:

- *A route that exists but is not documented* — it works perfectly and the app cannot discover it.
- *A route that is documented but not implemented* — the app calls it and gets a 404.

Nothing else in the project would notice either. The two tests cross-check each other: if the source scanner broke and found nothing, the second test would fail immediately.

Right now it finds 39 routes in the routers plus `/health` on the app, matching the 40 contract entries exactly.

### "the endpoint names have not changed"

A literal list of all forty `method path` strings, compared against the contract.

```
!! Endpoint names and field names are FROZEN once published. Three mobile
   developers build against this. A rename that costs two minutes here costs
   the team an afternoon.
```

This test is the enforcement. A rename now has to be a *deliberate* edit to that list, reviewed like any other change, rather than something that slips through in a refactor.

### The rest

- The document builds, and every contract entry appears in it.
- Every endpoint has a summary and a tag.
- No two endpoints share a method and a path.
- Every endpoint except `/health` requires the bearer token — and `/health` is the only public one.
- URL-to-contract matching, including `result.pdf` matching `{type}` and a literal path winning over a parameter path.
- The schemas accept and reject the right things: a body-less `POST /plan/generate` is accepted, an empty `PATCH` is refused, marks accept a number *or* `null` *or* an absence flag, and an unknown query parameter is ignored rather than rejected.

## Verifying it all

```
npm run typecheck     # 0 errors
npm test              # 74 passed  (55 planner/grading + 19 contract)
npm run openapi        # writes docs/openapi.json
npm run dev
npm run smoke 8       # 39 passed
```

The spec was also checked structurally: 50 schema references, none broken, no unused schemas, every operation has a summary, tags, a success response and a documented 500, and every path parameter is declared.

!NOTE If you add an endpoint and forget to add it to the contract, `npm test` fails and tells you which one. That is the whole point — the docs are not something to remember to update, they are something the test suite refuses to let you skip.
