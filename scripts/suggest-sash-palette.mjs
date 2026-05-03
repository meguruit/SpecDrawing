// One-shot helper for ⑰ サッシ枠 palette curation. For each variant base
// declared on scene `main`, samples the mean RGB in a ring outside the
// part-17 mask (default: 32 px wide). For each existing ⑰ option on the
// アーバンシー sheet, prints a suggested per-variant hex value computed as
// the option's nominal hex blended toward the variant's surrounding mean
// by a configurable weight (default 30%). The designer can copy the
// printed JSON into resources/catalog/finish-variant-mapping.json under
// the `colorHexByVariant` block and tune to taste.
//
// Run with: node scripts/suggest-sash-palette.mjs [ringWidthPx] [blendWeight]

import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCENE_DIR = resolve(ROOT, "public/assets/base/main");
const SCENE_JSON = resolve(SCENE_DIR, "scene.json");
const PARTS_JSON = resolve(SCENE_DIR, "parts.json");
const OPTIONS_JSON = resolve(ROOT, "public/catalog/finish-options.json");
const RESOURCES_BASE = resolve(ROOT, "resources/base");
const PART_ID = "17";
const PRIMARY_SHEET = "アーバンシー";

const RING_WIDTH = parseInt(process.argv[2] ?? "32", 10);
const BLEND_WEIGHT = parseFloat(process.argv[3] ?? "0.3");

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`bad hex ${hex}`);
  return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}
function rgbToHex(rgb) {
  const c = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(rgb.r)}${c(rgb.g)}${c(rgb.b)}`;
}
function blend(a, b, w) {
  return {
    r: a.r * (1 - w) + b.r * w,
    g: a.g * (1 - w) + b.g * w,
    b: a.b * (1 - w) + b.b * w,
  };
}

async function loadVariantBase(key, w, h) {
  const path = resolve(RESOURCES_BASE, `ベースパース_${key}.jpg`);
  const { data } = await sharp(path).resize(w, h, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return data;
}
async function loadMask(maskRel, w, h) {
  const { data, info } = await sharp(resolve(SCENE_DIR, maskRel)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.width !== w || info.height !== h) {
    throw new Error(`mask ${maskRel} dims (${info.width}×${info.height}) ≠ scene (${w}×${h})`);
  }
  return { data, channels: info.channels };
}

function partOuterVertices(part) {
  if (Array.isArray(part.polygons)) return part.polygons.flatMap((p) => p.outer);
  if (Array.isArray(part.polygon)) return part.polygon;
  throw new Error(`part ${part.id} has neither polygons nor polygon`);
}
function bbox(verts, w, h, pad = 8) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of verts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return {
    x: Math.max(0, Math.floor(minX) - pad),
    y: Math.max(0, Math.floor(minY) - pad),
    width: Math.min(w, Math.ceil(maxX) + pad) - Math.max(0, Math.floor(minX) - pad),
    height: Math.min(h, Math.ceil(maxY) + pad) - Math.max(0, Math.floor(minY) - pad),
  };
}

function ringMean(rgb, mask, channels, sceneW, box, ringWidth) {
  // Sample pixels inside the box where mask alpha is < 8 (outside the
  // part) AND any neighbor within `ringWidth` Chebyshev distance is
  // opaque (> 128) — i.e. the immediate surroundings.
  let sumR = 0, sumG = 0, sumB = 0, kept = 0;
  for (let dy = 0; dy < box.height; dy++) {
    const sy = box.y + dy;
    for (let dx = 0; dx < box.width; dx++) {
      const sx = box.x + dx;
      const i = sy * sceneW + sx;
      const a = mask[i * channels + (channels - 1)];
      if (a > 8) continue;
      let inRing = false;
      const x0 = Math.max(0, sx - ringWidth);
      const x1 = Math.min(sceneW - 1, sx + ringWidth);
      const y0 = Math.max(0, sy - ringWidth);
      const y1 = Math.min(box.y + box.height - 1, sy + ringWidth);
      for (let qy = y0; qy <= y1 && !inRing; qy++) {
        for (let qx = x0; qx <= x1 && !inRing; qx++) {
          const qI = qy * sceneW + qx;
          if (mask[qI * channels + (channels - 1)] > 128) inRing = true;
        }
      }
      if (!inRing) continue;
      sumR += rgb[i * 3];
      sumG += rgb[i * 3 + 1];
      sumB += rgb[i * 3 + 2];
      kept++;
    }
  }
  if (kept === 0) return { r: 128, g: 128, b: 128, kept };
  return { r: sumR / kept, g: sumG / kept, b: sumB / kept, kept };
}

async function main() {
  const scene = JSON.parse(await readFile(SCENE_JSON, "utf-8"));
  const parts = JSON.parse(await readFile(PARTS_JSON, "utf-8"));
  const options = JSON.parse(await readFile(OPTIONS_JSON, "utf-8")).options;
  const part = parts.parts.find((p) => p.id === PART_ID);
  if (!part) throw new Error(`part ${PART_ID} not in parts.json`);

  const mask = await loadMask(part.mask, scene.width, scene.height);
  const box = bbox(partOuterVertices(part), scene.width, scene.height);
  const ringByVariant = {};
  for (const v of scene.variants ?? []) {
    const rgb = await loadVariantBase(v.key, scene.width, scene.height);
    ringByVariant[v.key] = ringMean(rgb, mask.data, mask.channels, scene.width, box, RING_WIDTH);
  }

  console.log(`\nNeighborhood ring means (ring width = ${RING_WIDTH}px):`);
  for (const [k, m] of Object.entries(ringByVariant)) {
    console.log(`  ${k.padEnd(8)} → ${rgbToHex(m)} (${m.kept} px sampled)`);
  }

  console.log(`\nSuggested colorHexByVariant for ⑰ options (blend weight = ${BLEND_WEIGHT}, lower = closer to nominal hex):\n`);
  const suggestions = {};
  const sashOptions = options.filter(
    (o) => o.partId === PART_ID && o.sheet === PRIMARY_SHEET && o.colorHex,
  );
  for (const opt of sashOptions) {
    const nominal = hexToRgb(opt.colorHex);
    const perVariant = {};
    for (const [k, m] of Object.entries(ringByVariant)) {
      perVariant[k] = rgbToHex(blend(nominal, m, BLEND_WEIGHT));
    }
    suggestions[opt.label] = perVariant;
  }
  console.log(JSON.stringify({ [PART_ID]: suggestions }, null, 2));
  console.log(
    "\nCopy the block above into resources/catalog/finish-variant-mapping.json under",
  );
  console.log(`  "colorHexByVariant" and tune to taste, then re-run \`npm run seed:variants\`.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
