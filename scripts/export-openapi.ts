/**
 * Write the OpenAPI spec to a file.
 *
 *   npm run openapi
 *
 * The spec is always available live at http://localhost:4000/openapi.json. This
 * writes the same thing to docs/openapi.json so that:
 *
 *   - the mobile team can run a mock server without the backend running at all
 *   - the contract is committed, so a diff shows exactly what changed between
 *     commits and a rename cannot slip through review unnoticed
 *
 * To mock it, from the mobile repo:
 *
 *   npx @stoplight/prism-cli mock docs/openapi.json
 *
 * That serves every endpoint on port 4010, answering with the examples in the
 * spec. Point the app's base URL at it, build every screen, then switch the one
 * base URL when the real endpoint lands.
 *
 * Nothing is installed here — prism is a mobile-side dev tool and this backend's
 * dependency list stays closed.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { buildDocument } from "../src/openapi/document.ts";

const out = process.argv[2] ?? "docs/openapi.json";

const document = buildDocument();

mkdirSync(out.replace(/[^/\\]+$/, "") || ".", { recursive: true });
writeFileSync(out, JSON.stringify(document, null, 2) + "\n", "utf8");

const operations = Object.values(document.paths ?? {}).reduce(
  (total, path) => total + Object.keys(path as object).length,
  0,
);

console.log(
  `Wrote ${out}\n` +
    `  ${Object.keys(document.paths ?? {}).length} paths, ` +
    `${operations} operations, ` +
    `${Object.keys(document.components?.schemas ?? {}).length} schemas`,
);
