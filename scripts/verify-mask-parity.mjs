// Verifies that the multi-ring rasterizer produces byte-identical mask
// PNGs for parts that have a single outer ring and no holes (the result of
// running `migrate-parts-multiring.mjs` on a legacy `parts.json`).
//
// Usage:
//   1. Before migration: `node scripts/verify-mask-parity.mjs --capture`
//      → records SHA-256 of every mask_<NN>.png to /tmp/mask-parity.json
//   2. Run `npm run migrate:multiring` and `npm run seed:masks`
//   3. After regen:    `node scripts/verify-mask-parity.mjs --check`
//      → re-hashes every mask_<NN>.png and compares; exits non-zero on diff

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCENE_DIR = resolve(ROOT, "public/assets/base/main");
const PARTS_PATH = resolve(SCENE_DIR, "parts.json");
const PARITY_PATH = "/tmp/mask-parity.json";

async function sha256(path) {
  const buf = await readFile(path);
  return createHash("sha256").update(buf).digest("hex");
}

async function hashesByPart() {
  const manifest = JSON.parse(await readFile(PARTS_PATH, "utf-8"));
  const out = {};
  for (const part of manifest.parts) {
    const path = resolve(SCENE_DIR, part.mask);
    out[part.id] = await sha256(path);
  }
  return out;
}

async function main() {
  const mode = process.argv[2];
  if (mode === "--capture") {
    const map = await hashesByPart();
    await writeFile(PARITY_PATH, JSON.stringify(map, null, 2) + "\n", "utf-8");
    console.log(`Captured ${Object.keys(map).length} hashes → ${PARITY_PATH}`);
    return;
  }
  if (mode === "--check") {
    let prior;
    try {
      prior = JSON.parse(await readFile(PARITY_PATH, "utf-8"));
    } catch (err) {
      if (err.code === "ENOENT") {
        console.error(
          `${PARITY_PATH} not found — run \`node scripts/verify-mask-parity.mjs --capture\` first`,
        );
        process.exit(2);
      }
      throw err;
    }
    const now = await hashesByPart();
    const diffs = [];
    for (const id of Object.keys(prior)) {
      if (prior[id] !== now[id]) {
        diffs.push({ id, before: prior[id], after: now[id] ?? "(missing)" });
      }
    }
    for (const id of Object.keys(now)) {
      if (!(id in prior)) diffs.push({ id, before: "(missing)", after: now[id] });
    }
    if (diffs.length === 0) {
      console.log(
        `OK: every part's mask is byte-identical (${Object.keys(now).length} parts)`,
      );
      return;
    }
    console.error(`DIFF: ${diffs.length} mask(s) changed:`);
    for (const d of diffs) console.error(` - part ${d.id}: ${d.before} → ${d.after}`);
    process.exit(1);
  }
  console.error("Usage: verify-mask-parity.mjs --capture | --check");
  process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
