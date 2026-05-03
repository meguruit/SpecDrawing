// One-shot migration: rewrite the legacy `polygon: Vertex[]` field on every
// part record in `public/assets/base/main/parts.json` to the new multi-ring
// shape `polygons: [{ outer: <existing-vertices> }]`. The rasterizer,
// hit-test, and `/dev/trace` UI all consume `polygons`.
//
// Idempotent: running on an already-migrated file produces no diff.
//
// Run: `npm run migrate:multiring` (or `node scripts/migrate-parts-multiring.mjs`)
//
// After running:
//   1. `npm run seed:masks` to regenerate every mask under the new sidecar hash
//   2. Smoke `/` and `/dev/trace`
//   3. Commit the migrated `parts.json` plus the regenerated PNGs

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PARTS_PATH = resolve(ROOT, "public/assets/base/main/parts.json");

async function main() {
  const raw = await readFile(PARTS_PATH, "utf-8");
  const json = JSON.parse(raw);
  if (!Array.isArray(json?.parts)) {
    throw new Error(`Unexpected shape at ${PARTS_PATH}: missing parts array`);
  }
  let mutated = 0;
  for (const part of json.parts) {
    if (Array.isArray(part.polygon) && !part.polygons) {
      part.polygons = [{ outer: part.polygon }];
      delete part.polygon;
      mutated++;
    }
  }
  // Preserve the existing trailing-newline convention.
  await writeFile(PARTS_PATH, JSON.stringify(json, null, 2) + "\n", "utf-8");
  console.log(`Migrated ${mutated} parts to multi-ring shape`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
