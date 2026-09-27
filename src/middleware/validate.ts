/**
 * Request validation, driven by the same contract that generates the docs.
 *
 * This is mounted ONCE in index.ts, before the routers. It looks the incoming
 * request up in CONTRACT and checks the body and query against the schema
 * documented at /docs. So a request the Swagger UI says is valid is accepted, and
 * one it says is invalid is refused with the same reason — there is no second
 * definition that could disagree.
 *
 * Two deliberate limits:
 *
 *   1. It VALIDATES but does not REPLACE req.body. Zod strips unknown keys, and
 *      silently dropping a field the app thought it sent would be worse than
 *      ignoring it. The services read what was actually sent.
 *
 *   2. A path not in the contract is passed straight through, so the 404 handler
 *      still answers it. This middleware is not a gatekeeper — it only checks
 *      the things the contract describes.
 *
 * The services keep their own checks. Those produce better domain messages
 * ("min_sessions (3) cannot be more than sessions_needed (2)") than a schema can,
 * and they are what guarantee correctness. This layer catches the shape.
 */

import type { NextFunction, Request, Response } from "express";
import type { ZodType } from "zod";
import { badRequest } from "../http.ts";
import { CONTRACT, type EndpointDef, type HttpMethod } from "../openapi/contract.ts";

/**
 * Turn an OpenAPI path into a regex.
 *
 *   /courses/{courseId}/topics  ->  ^/courses/([^/]+)/topics$
 *
 * Literal segments are escaped so a dot in a path cannot act as a wildcard.
 */
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

type CompiledEndpoint = EndpointDef & { regex: RegExp; paramCount: number };

/**
 * Compiled once at startup, and sorted so the most specific path wins.
 *
 * This matters for one real collision: POST /courses/{id}/students/import has the
 * same shape as DELETE /courses/{id}/students/{studentId}. The methods differ so
 * they would not actually clash, but ordering literal segments first means a
 * future addition cannot introduce that bug quietly.
 */
const COMPILED: CompiledEndpoint[] = CONTRACT.map((endpoint) => ({
  ...endpoint,
  regex: compile(endpoint.path),
  paramCount: (endpoint.path.match(/\{/g) ?? []).length,
})).sort((a, b) => a.paramCount - b.paramCount);

function findMatch(method: string, path: string): CompiledEndpoint | undefined {
  const wanted = method.toLowerCase() as HttpMethod;
  return COMPILED.find((e) => e.method === wanted && e.regex.test(path));
}

/** Turn a Zod failure into one sentence a developer can act on. */
function describe(error: unknown, where: string): string {
  const issues = (error as { issues?: { path: (string | number)[]; message: string }[] }).issues;

  if (!issues || issues.length === 0) return `The request ${where} is not valid`;

  const parts = issues.slice(0, 4).map((issue) => {
    const field = issue.path.join(".");
    return field === "" ? issue.message : `${field}: ${issue.message}`;
  });

  const more = issues.length > 4 ? ` (and ${issues.length - 4} more)` : "";
  return `${parts.join("; ")}${more}`;
}

function check(schema: ZodType, value: unknown, where: string): void {
  const result = schema.safeParse(value);
  if (!result.success) throw badRequest(describe(result.error, where));
}

export function validateAgainstContract(req: Request, _res: Response, next: NextFunction): void {
  const endpoint = findMatch(req.method, req.path);

  // Not a documented path. Let it fall through to the routers and, failing
  // those, to notFoundHandler.
  if (!endpoint) {
    next();
    return;
  }

  if (endpoint.query) {
    check(endpoint.query, req.query, "query string");
  }

  if (endpoint.body) {
    // express.json() leaves req.body as {} when there was no body at all. A
    // schema whose fields are all optional accepts that, which is correct —
    // POST /plan/generate with no body is a valid request.
    check(endpoint.body, req.body ?? {}, "body");
  }

  next();
}

/** Exported for tests: the compiled table, so a test can assert it covers the routers. */
export const compiledEndpoints = COMPILED;
