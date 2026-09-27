/**
 * The server.
 *
 * Read this file top to bottom and you have the whole shape of the backend:
 * what parses the request, which routers handle which URLs, and what catches
 * whatever falls through.
 *
 * ORDER MATTERS HERE. Express walks this list from top to bottom for every
 * request, so express.json() has to come before any route that reads req.body,
 * and the two handlers at the bottom have to be last — they are the safety net.
 */

import express from "express";
import { ok } from "./http.ts";
import { errorHandler, notFoundHandler } from "./middleware/error.ts";

import authRoutes from "./routes/auth.ts";
import courseRoutes from "./routes/courses.ts";
import planRoutes from "./routes/plan.ts";
import sessionRoutes from "./routes/sessions.ts";
import topicRoutes from "./routes/topics.ts";
import assessmentRoutes from "./routes/assessments.ts";
import studentRoutes from "./routes/students.ts";
import materialRoutes from "./routes/materials.ts";

const app = express();

// Turns the JSON body of a request into req.body. Without it, req.body is
// undefined and every POST looks empty.
app.use(express.json());

// A request that reaches this is proof the server is up and can answer. It does
// not touch the database on purpose, so it stays fast and never lies about the
// server being down when it is really the database that is unreachable.
app.get("/health", (_req, res) => {
  ok(res, { status: "ok" });
});

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

const PORT = Number(process.env.PORT ?? 4000);

app.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
});
