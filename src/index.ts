/**
 * The local server.
 *
 * This is what `npm run dev` and `npm start` run. It does one thing: take the
 * app built in src/app.ts and start listening on a port.
 *
 * On Vercel this file is never used — api/index.ts is the entry point there,
 * because a serverless platform invokes a function per request rather than
 * running a process that listens. The app itself is identical in both cases.
 */

import app from "./app.ts";

const PORT = Number(process.env.PORT ?? 4000);

app.listen(PORT, () => {
  console.log(`Listening on http://localhost:${PORT}`);
  console.log(`Docs at      http://localhost:${PORT}/docs`);
});
