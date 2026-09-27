/**
 * Turns the contract into an OpenAPI 3.1 document.
 *
 * Nothing here is hand-written per endpoint — it loops over CONTRACT. So the
 * spec at /openapi.json and the Swagger UI at /docs cannot drift from the code,
 * because there is no second place to edit. CLAUDE.md: "generated, never
 * hand-written".
 */

import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  type ResponseConfig,
} from "@asteasolutions/zod-to-openapi";
import { z } from "./zod.ts";
import { CONTRACT, type EndpointDef } from "./contract.ts";

/**
 * The success envelope. Every endpoint wraps its payload in this.
 *
 * It is built per endpoint rather than registered once as a component, because
 * `data` is a different shape each time.
 */
const success = (data: z.ZodType) =>
  z.object({
    success: z.literal(true),
    data,
    message: z.null(),
  });

const ErrorResponse = z
  .object({
    success: z.literal(false),
    data: z.null(),
    message: z.string().openapi({ example: "Course not found" }),
  })
  .openapi("ErrorResponse");

/** The error responses every authenticated endpoint can return. */
const COMMON_ERRORS: Record<number, string> = {
  400: "Something in the request was wrong — a bad value, a missing field, or a body that is not valid JSON.",
  401: "No token, or a token that does not verify.",
  404: "Does not exist — or belongs to another teacher. Both answer 404 on purpose: a 403 would confirm the id is real.",
  409: "Would duplicate a row that already exists.",
  415: "The uploaded file is not a type that can be read. Send a PDF, or a JPG or PNG photo.",
  422: "The file was read, but nothing usable was found in it. The message says what was expected.",
  502: "Supabase Storage could not be reached to fetch the uploaded file.",
  500: "A bug on our side. The real error is in the server log, never in the response.",
  503: "The feature exists but its tool is not configured yet. The message names the workaround.",
};

function errorResponses(endpoint: EndpointDef) {
  const codes = new Set<number>([500]);

  if (!endpoint.isPublic) codes.add(401);
  if (endpoint.params) codes.add(404);
  if (endpoint.body) codes.add(400);
  for (const code of endpoint.errors ?? []) codes.add(code);

  const responses: Record<string, ResponseConfig> = {};

  for (const code of [...codes].sort((a, b) => a - b)) {
    responses[String(code)] = {
      description: COMMON_ERRORS[code] ?? "Error",
      content: { "application/json": { schema: ErrorResponse } },
    };
  }

  return responses;
}

export function buildDocument() {
  const registry = new OpenAPIRegistry();

  // The one security scheme: the Supabase access token, as a bearer token.
  const bearerAuth = registry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description:
      "The `access_token` Supabase Auth returns when the teacher signs in, inside the app. " +
      "Send it as `Authorization: Bearer <token>`. This API only verifies it — it never issues one.",
  });

  registry.register("ErrorResponse", ErrorResponse);

  for (const endpoint of CONTRACT) {
    const successBody = endpoint.raw
      ? { "application/pdf": { schema: z.string().openapi({ format: "binary" }) } }
      : { "application/json": { schema: success(endpoint.response) } };

    registry.registerPath({
      method: endpoint.method,
      path: endpoint.path,
      tags: [endpoint.tag],
      summary: endpoint.summary,
      description: endpoint.description,
      security: endpoint.isPublic ? [] : [{ [bearerAuth.name]: [] }],
      request: {
        params: endpoint.params as never,
        query: endpoint.query as never,
        body: endpoint.body
          ? { content: { "application/json": { schema: endpoint.body } }, required: true }
          : undefined,
      },
      responses: {
        [String(endpoint.status ?? 200)]: {
          description: endpoint.summary,
          content: successBody,
        },
        ...errorResponses(endpoint),
      },
    });
  }

  const generator = new OpenApiGeneratorV31(registry.definitions);

  return generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "UstaadAssist API",
      version: "1.0.0",
      description: [
        "The backend for UstaadAssist — a semester planner for university teachers.",
        "",
        "## Read this first",
        "",
        "**Every response has the same three keys.** Success or failure, always:",
        "",
        "```json",
        '{ "success": true,  "data": { }, "message": null }',
        '{ "success": false, "data": null, "message": "Course not found" }',
        "```",
        "",
        "So the app can be written once: check `success`, use `data`, or show `message`.",
        "The only exception is a report `.pdf`, which returns bytes.",
        "",
        "**Every field is `snake_case`**, matching the database columns. There is no",
        "mapping layer, so what you see here is what is in the database.",
        "",
        "**Ids are strings.** Every id column is a PostgreSQL `bigint`, and the driver",
        "returns those as strings so no precision is lost. Treat them as opaque — do not",
        "parse them into numbers.",
        "",
        "**Authentication is not done here.** The teacher signs in through Supabase Auth",
        "inside the app. This API only verifies the token and returns `401` if it does not",
        "check out. There is no login, signup or password endpoint, and there never will be.",
        "",
        "**A `404` may mean 'not yours'.** Every id is scoped to the signed-in teacher. A row",
        "that exists but belongs to someone else answers `404`, not `403`, so the API never",
        "confirms which ids are real.",
        "",
        "## Where to start",
        "",
        "1. `GET /auth/me` right after sign-in — it creates the teacher record on first call.",
        "2. `POST /courses` with name, dates and class days. Holidays are preloaded for you.",
        "3. `POST /courses/{id}/topics` with the whole textarea as one string.",
        "4. `POST /courses/{id}/plan/generate` — and the timetable exists.",
        "",
        "Students, weightage, the grade scale and material are all asked for later, by the",
        "screens that need them. Nothing else is required to get a plan.",
        "",
        "## Two features answer 503 today",
        "",
        "Document extraction (the class-list photo and the outline import) and PDF",
        "rendering. Both are finished except for the tool, and both return a message naming",
        "the workaround. The report endpoints without `.pdf` return the complete report as",
        "JSON right now, so the preview screen can be built against them.",
        "",
        "## The `today` query parameter",
        "",
        "Several endpoints accept `?today=YYYY-MM-DD` to override the server's idea of the",
        "current date. It exists so a whole semester can be demonstrated without waiting",
        "four months. Leave it out in normal use.",
      ].join("\n"),
      contact: { name: "Backend" },
    },
    // "/" means "whichever server is showing these docs". A fixed address such as
    // http://localhost:4000 made the Swagger page on Vercel send every request to
    // the viewer's own computer, which fails with "Failed to fetch".
    servers: [{ url: "/", description: "This server" }],
    tags: [
      { name: "Health", description: "Is the server up" },
      { name: "Auth", description: "The signed-in teacher. Sign-in itself is Supabase, in the app." },
      { name: "Courses", description: "Create, list, edit and clone courses" },
      { name: "Topics", description: "The syllabus. One textarea, one topic per line." },
      { name: "Holidays", description: "Preloaded public holidays the teacher ticks or unticks" },
      {
        name: "Planner",
        description:
          "The core of the app. Generates the timetable, rebuilds it after disruptions while freezing the past, and computes three ways out when time runs short.",
      },
      { name: "Sessions", description: "Individual classes: the week view, conducted and cancelled" },
      { name: "Attendance", description: "Present by default — send only the absentees" },
      { name: "Students", description: "The class list. Photographed and reviewed, never typed." },
      { name: "Assessments", description: "Quizzes, assignments, midterm, final" },
      { name: "Marks", description: "Mark entry. A missing mark is never a zero." },
      { name: "Grading", description: "Weightage, grade scale, and the computed results" },
      { name: "Material", description: "Records pointing at files in Supabase Storage" },
      { name: "Dashboard", description: "Every number for the home screen, in one request" },
      { name: "Reports", description: "Result, attendance and course reports" },
    ],
  });
}
