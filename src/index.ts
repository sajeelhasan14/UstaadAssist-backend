import express from "express";
import { ok, notFound } from "./http.ts";
import { errorHandler, notFoundHandler } from "./middleware/error.ts";

const app = express();

app.use(express.json());

app.get("/health", (req, res) => {
  ok(res, { status: "ok" });
});

// Temporary — delete both after testing.
app.get("/boom", (req, res) => {
  throw new Error("kaboom");
});

app.get("/courses/:id", (req, res) => {
  throw notFound("Course");
});

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(4000, () => {
  console.log("Listening on http://localhost:4000");
});
