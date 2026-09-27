/**
 * Tests for the API contract itself.
 *
 * These guard the thing three mobile developers depend on: that the docs at
 * /docs describe the routes that actually exist, and that the endpoint and field
 * names have not quietly changed.
 *
 * They need no database and no server — the contract and the OpenAPI document
 * are both built from plain data.
 *
 * Run with:  npm test
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

import { CONTRACT, findEndpoint } from "../src/openapi/contract.ts";
import { buildDocument } from "../src/openapi/document.ts";
import { compiledEndpoints } from "../src/middleware/validate.ts";

// ------------------------------------------------- the document itself

test("the OpenAPI document builds", () => {
  const doc = buildDocument();

  assert.equal(doc.openapi, "3.1.0");
  assert.equal(doc.info.title, "UstaadAssist API");
  assert.ok(Object.keys(doc.paths ?? {}).length > 0);
});

test("every endpoint in the contract appears in the document", () => {
  const doc = buildDocument();

  for (const endpoint of CONTRACT) {
    const path = doc.paths?.[endpoint.path];
    assert.ok(path, `${endpoint.path} is missing from the document`);

    const operation = (path as Record<string, unknown>)[endpoint.method];
    assert.ok(operation, `${endpoint.method.toUpperCase()} ${endpoint.path} is missing`);
  }
});

test("every endpoint has a summary and a tag", () => {
  for (const endpoint of CONTRACT) {
    assert.ok(endpoint.summary.length > 0, `${endpoint.path} has no summary`);
    assert.ok(endpoint.tag.length > 0, `${endpoint.path} has no tag`);
  }
});

test("no two endpoints share a method and a path", () => {
  const seen = new Set<string>();

  for (const endpoint of CONTRACT) {
    const key = `${endpoint.method} ${endpoint.path}`;
    assert.ok(!seen.has(key), `${key} is defined twice`);
    seen.add(key);
  }
});

test("every endpoint except health requires the bearer token", () => {
  const doc = buildDocument();

  for (const endpoint of CONTRACT) {
    const operation = (doc.paths?.[endpoint.path] as Record<string, { security?: unknown[] }>)[
      endpoint.method
    ]!;

    if (endpoint.isPublic) {
      assert.deepEqual(operation.security, [], `${endpoint.path} should be public`);
    } else {
      assert.ok(
        (operation.security?.length ?? 0) > 0,
        `${endpoint.method.toUpperCase()} ${endpoint.path} is not protected`,
      );
    }
  }
});

test("only /health is public", () => {
  const publicPaths = CONTRACT.filter((e) => e.isPublic).map((e) => e.path);
  assert.deepEqual(publicPaths, ["/health"]);
});

// ------------------------------------------- the contract vs the routers

/**
 * Read the paths the routers actually declare, straight out of the source.
 *
 * This is the test that matters most. A route can be written, working and
 * unreachable-by-the-docs, or documented and never implemented, and nothing else
 * in the project would notice. Comparing the two lists catches both.
 */
function routerPaths(): Set<string> {
  const mounts: Record<string, string> = {
    "auth.ts": "/auth",
    "courses.ts": "/courses",
    "plan.ts": "/courses",
    "sessions.ts": "/sessions",
    "topics.ts": "/topics",
    "assessments.ts": "/assessments",
    "students.ts": "/students",
    "materials.ts": "/materials",
  };

  const found = new Set<string>();

  for (const file of readdirSync("src/routes")) {
    const prefix = mounts[file];
    assert.ok(prefix !== undefined, `src/routes/${file} is not listed in this test's mount table`);

    const source = readFileSync(`src/routes/${file}`, "utf8");
    const pattern = /router\.(get|post|patch|put|delete)\(\s*"([^"]*)"/g;

    for (const match of source.matchAll(pattern)) {
      const method = match[1]!;
      const routePath = match[2]!;

      // Express ":name" becomes OpenAPI "{name}", and the mount prefix is added
      // back on, since the router never sees it.
      const full = `${prefix}${routePath}`
        .replace(/\/$/, "")
        .replace(/:([A-Za-z0-9_]+)/g, "{$1}");

      found.add(`${method} ${full === "" ? "/" : full}`);
    }
  }

  return found;
}

test("every mounted route is documented", () => {
  const documented = new Set(CONTRACT.map((e) => `${e.method} ${e.path}`));
  documented.add("get /health"); // declared on the app, not in a router

  const undocumented = [...routerPaths()].filter((route) => !documented.has(route));

  assert.deepEqual(
    undocumented,
    [],
    `These routes exist but are not in the contract, so the app cannot discover them: ${undocumented.join(", ")}`,
  );
});

test("every documented route is implemented", () => {
  const implemented = routerPaths();
  implemented.add("get /health");

  const missing = CONTRACT.map((e) => `${e.method} ${e.path}`).filter(
    (route) => !implemented.has(route),
  );

  assert.deepEqual(
    missing,
    [],
    `These are documented but no router declares them, so the app would get a 404: ${missing.join(", ")}`,
  );
});

// -------------------------------------------------- frozen names

/**
 * The endpoint names are frozen once published. Three developers build against
 * them, so a rename has to be a deliberate change to this list, not an accident
 * in a refactor.
 */
test("the endpoint names have not changed", () => {
  const expected = [
    "get /auth/me",
    "get /courses",
    "post /courses",
    "get /courses/{courseId}",
    "patch /courses/{courseId}",
    "post /courses/{courseId}/assessments",
    "get /courses/{courseId}/assessments",
    "get /courses/{courseId}/attendance/summary",
    "post /courses/{courseId}/clone",
    "get /courses/{courseId}/dashboard",
    "get /courses/{courseId}/grade-scale",
    "put /courses/{courseId}/grade-scale",
    "get /courses/{courseId}/holidays",
    "post /courses/{courseId}/holidays",
    "get /courses/{courseId}/materials",
    "post /courses/{courseId}/materials",
    "post /courses/{courseId}/outline/import",
    "get /courses/{courseId}/plan/deficit",
    "post /courses/{courseId}/plan/deficit/apply",
    "post /courses/{courseId}/plan/generate",
    "post /courses/{courseId}/plan/replan",
    "get /courses/{courseId}/reports/{type}",
    "get /courses/{courseId}/results",
    "get /courses/{courseId}/sessions",
    "get /courses/{courseId}/students",
    "delete /courses/{courseId}/students/{studentId}",
    "post /courses/{courseId}/students/extract",
    "post /courses/{courseId}/students/import",
    "post /courses/{courseId}/topics",
    "get /courses/{courseId}/weightage",
    "put /courses/{courseId}/weightage",
    "get /health",
    "get /assessments/{id}/marks",
    "post /assessments/{id}/marks",
    "delete /materials/{id}",
    "patch /sessions/{id}",
    "get /sessions/{id}/attendance",
    "post /sessions/{id}/attendance",
    "get /students/{id}",
    "patch /topics/{id}",
  ].sort();

  const actual = CONTRACT.map((e) => `${e.method} ${e.path}`).sort();

  assert.deepEqual(actual, expected);
});

// -------------------------------------------- path matching for validation

test("a real URL matches the right contract entry", () => {
  const cases: [string, string, string][] = [
    ["post", "/courses/8/topics", "/courses/{courseId}/topics"],
    ["get", "/courses/8", "/courses/{courseId}"],
    ["get", "/courses", "/courses"],
    ["patch", "/sessions/244", "/sessions/{id}"],
    ["post", "/sessions/244/attendance", "/sessions/{id}/attendance"],
    ["get", "/courses/8/plan/deficit", "/courses/{courseId}/plan/deficit"],
    ["post", "/courses/8/plan/deficit/apply", "/courses/{courseId}/plan/deficit/apply"],
    ["get", "/courses/8/reports/result", "/courses/{courseId}/reports/{type}"],
    ["get", "/courses/8/reports/result.pdf", "/courses/{courseId}/reports/{type}"],
    ["delete", "/courses/8/students/12", "/courses/{courseId}/students/{studentId}"],
  ];

  for (const [method, url, expectedPath] of cases) {
    const match = compiledEndpoints.find((e) => e.method === method && e.regex.test(url));
    assert.ok(match, `${method.toUpperCase()} ${url} matched nothing`);
    assert.equal(match.path, expectedPath, `${method.toUpperCase()} ${url}`);
  }
});

test("a literal path wins over a parameter path of the same shape", () => {
  // POST /courses/8/students/import must not be read as a studentId.
  const match = compiledEndpoints.find(
    (e) => e.method === "post" && e.regex.test("/courses/8/students/import"),
  );

  assert.equal(match?.path, "/courses/{courseId}/students/import");
});

test("a dot in a path is not treated as a wildcard", () => {
  // The regex for /health must not match /healthX.
  const health = compiledEndpoints.find((e) => e.path === "/health")!;

  assert.ok(health.regex.test("/health"));
  assert.ok(!health.regex.test("/healthy"));
});

// ----------------------------------------------------- schema behaviour

test("the create-course body rejects what the service would reject", () => {
  const endpoint = findEndpoint("post", "/courses")!;
  const body = endpoint.body!;

  assert.ok(
    body.safeParse({
      name: "Database Systems",
      start_date: "2026-09-01",
      end_date: "2026-12-18",
      class_days: ["mon", "wed"],
    }).success,
  );

  assert.ok(!body.safeParse({ name: "", start_date: "2026-09-01", end_date: "2026-12-18", class_days: ["mon"] }).success, "empty name");
  assert.ok(!body.safeParse({ name: "X", start_date: "01-09-2026", end_date: "2026-12-18", class_days: ["mon"] }).success, "wrong date format");
  assert.ok(!body.safeParse({ name: "X", start_date: "2026-09-01", end_date: "2026-12-18", class_days: [] }).success, "no class days");
  assert.ok(!body.safeParse({ name: "X", start_date: "2026-09-01", end_date: "2026-12-18", class_days: ["funday"] }).success, "not a day");
});

test("cancelling a class without a reason is refused by the schema", () => {
  const body = findEndpoint("patch", "/sessions/{id}")!.body!;

  assert.ok(body.safeParse({ status: "conducted" }).success);
  assert.ok(body.safeParse({ status: "cancelled", cancel_reason: "University closed" }).success);
  assert.ok(!body.safeParse({ status: "cancelled" }).success, "no reason given");
  assert.ok(!body.safeParse({ status: "cancelled", cancel_reason: "   " }).success, "blank reason");
});

test("an empty PATCH body is refused", () => {
  assert.ok(!findEndpoint("patch", "/courses/{courseId}")!.body!.safeParse({}).success);
  assert.ok(!findEndpoint("patch", "/topics/{id}")!.body!.safeParse({}).success);
});

test("a body-less POST to plan/generate is accepted", () => {
  // The app calls this with no body at all, which express.json() leaves as {}.
  const body = findEndpoint("post", "/courses/{courseId}/plan/generate")!.body!;

  assert.ok(body.safeParse({}).success);
  assert.ok(body.safeParse({ reset: true }).success);
  assert.ok(!body.safeParse({ reset: "yes" }).success);
});

test("marks accept a number, a null, or an absence flag", () => {
  const body = findEndpoint("post", "/assessments/{id}/marks")!.body!;

  assert.ok(body.safeParse({ marks: [{ student_id: 1, obtained: 7.5 }] }).success);
  assert.ok(body.safeParse({ marks: [{ student_id: 1, obtained: null }] }).success, "clearing a mark");
  assert.ok(body.safeParse({ marks: [{ student_id: 1, is_absent: true }] }).success);
  assert.ok(body.safeParse({ marks: [{ student_id: "1" }] }).success, "ids may be strings");
  assert.ok(!body.safeParse({ marks: [] }).success, "empty list");
  assert.ok(!body.safeParse({ marks: [{ obtained: 5 }] }).success, "no student_id");
});

test("the today query parameter must be a date", () => {
  const query = findEndpoint("get", "/courses/{courseId}/dashboard")!.query!;

  assert.ok(query.safeParse({}).success, "omitting it is fine");
  assert.ok(query.safeParse({ today: "2026-11-18" }).success);
  assert.ok(!query.safeParse({ today: "18-11-2026" }).success);
  assert.ok(!query.safeParse({ today: "tomorrow" }).success);
});

test("an unknown query parameter is ignored, not rejected", () => {
  // The app may append cache-busting or tracking parameters. Those must not 400.
  const query = findEndpoint("get", "/courses/{courseId}/dashboard")!.query!;
  assert.ok(query.safeParse({ today: "2026-11-18", _t: "12345" }).success);
});
