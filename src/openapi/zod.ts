/**
 * Zod, with the `.openapi()` method added.
 *
 * `extendZodWithOpenApi` must run exactly once, before any schema is built, so
 * it happens here and every other file imports `z` from this module instead of
 * from "zod" directly. Importing plain zod somewhere else would work, but
 * `.openapi()` would be missing on those schemas.
 */

import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";

extendZodWithOpenApi(z);

export { z };
