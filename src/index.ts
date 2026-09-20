import express from "express";
const app = express();
app.get("/health", (req, res) => {
  res.json({
    success: true,
    data: { status: "ok" },
    message: "Kill The Juice",
  });
});
app.listen(4000, () => {
    console.log("Listening on http://localhost:4000");
})