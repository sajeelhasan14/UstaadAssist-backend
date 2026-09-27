/**
 * The Express app.
 *
 * Read this file top to bottom and you have the whole shape of the backend:
 * what parses the request, which routers handle which URLs, and what catches
 * whatever falls through.
 *
 * ORDER MATTERS HERE. Express walks this list from top to bottom for every
 * request, so express.json() has to come before any route that reads req.body,
 * and the two handlers at the bottom have to be last — they are the safety net.
 *
 * This file does NOT call app.listen(). It only builds the app and exports it,
 * which is what lets the same app run in two very different places:
 *
 *   src/index.ts   calls listen() — a normal long-running server (npm run dev)
 *   api/index.ts   exports it as a handler — one function per request (Vercel)
 *
 * An Express app is itself a function of (req, res), which is exactly what a
 * serverless platform invokes. So nothing here has to know which one it is.
 */

import express from "express";
import swaggerUi from "swagger-ui-express";
import { ok } from "./http.ts";
import { errorHandler, notFoundHandler } from "./middleware/error.ts";
import { validateAgainstContract } from "./middleware/validate.ts";
import { buildDocument } from "./openapi/document.ts";

import authRoutes from "./routes/auth.ts";
import courseRoutes from "./routes/courses.ts";
import planRoutes from "./routes/plan.ts";
import sessionRoutes from "./routes/sessions.ts";
import topicRoutes from "./routes/topics.ts";
import assessmentRoutes from "./routes/assessments.ts";
import studentRoutes from "./routes/students.ts";
import materialRoutes from "./routes/materials.ts";

const app = express();

/**
 * Behind Vercel (or any proxy) the client's real address arrives in the
 * X-Forwarded-For header. Trusting it makes req.ip correct instead of always
 * reporting the proxy. Nothing depends on this yet; it is here so that anything
 * added later which logs or rate-limits by address is right from the start.
 */
app.set("trust proxy", 1);

// Turns the JSON body of a request into req.body. Without it, req.body is
// undefined and every POST looks empty.
app.use(express.json());

// A request that reaches this is proof the server is up and can answer. It does
// not touch the database on purpose, so it stays fast and never lies about the
// server being down when it is really the database that is unreachable.
app.get("/health", (_req, res) => {
  ok(res, { status: "ok" });
});

/**
 * The API documentation.
 *
 * Built once when this module loads, from src/openapi/contract.ts, which is the
 * same definition request validation reads. So the docs cannot drift from the
 * code — there is no second place to update. CLAUDE.md: "generated, never
 * hand-written".
 *
 * These two are mounted before the validator and the routers because they are
 * the contract itself, and they need no token: the mobile team has to be able to
 * read them before they can sign in.
 */
const openApiDocument = buildDocument();

app.get("/openapi.json", (_req, res) => {
  res.json(openApiDocument);
});

app.use(
  "/docs",
  swaggerUi.serve,
  swaggerUi.setup(openApiDocument, {
    customSiteTitle: "UstaadAssist API",
    swaggerOptions: {
      // Keep the sidebar usable: 40 operations collapsed by tag rather than all
      // expanded, and a filter box for finding one quickly.
      docExpansion: "list",
      filter: true,
      persistAuthorization: true,
      tryItOutEnabled: true,
    },
  }),
);

/**
 * Checks the body and query of every documented request against its schema.
 *
 * Mounted here — after express.json() so there is a body to check, and before
 * the routers so a malformed request never reaches a service. One insertion
 * point for all 40 endpoints.
 */
app.use(validateAgainstContract);

app.use("/auth", authRoutes);

/**
 * Two routers share the /courses prefix.
 *
 * planRoutes is first because its paths are the most specific
 * (/:courseId/plan/generate). courseRoutes has a plain /:courseId route, and if
 * it were mounted first it would not swallow the planner URLs — Express matches
 * the full path, not a prefix — but keeping the planner on top makes the
 * ordering obvious to anyone reading this file, and it is the part of the app
 * that matters most.
 */
app.use("/courses", planRoutes);
app.use("/courses", courseRoutes);

app.use("/sessions", sessionRoutes);
app.use("/topics", topicRoutes);
app.use("/assessments", assessmentRoutes);
app.use("/students", studentRoutes);
app.use("/materials", materialRoutes);

// Nothing above matched the URL: answer 404 in our own JSON shape rather than
// letting Express send its default HTML page.
app.use(notFoundHandler);

// Something above threw. This is the only place in the codebase that sends an
// error response, which is why no controller ever has to.
app.use(errorHandler);

export default app;
