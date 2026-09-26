import express from "express";
import { ok } from "./http.ts";
import { errorHandler, notFoundHandler } from "./middleware/error.ts";
import authRoutes from "./routes/auth.ts";
import courseRoutes from "./routes/courses.ts";

const app = express();

app.use(express.json());

app.get("/health", (req, res) => {
  ok(res, { status: "ok" });
});

app.use("/auth", authRoutes);
app.use("/courses", courseRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

app.listen(4000, () => {
  console.log("Listening on http://localhost:4000");
});
