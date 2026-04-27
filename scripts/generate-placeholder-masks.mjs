// Generates PLACEHOLDER alpha masks and shading maps for every part in
// public/assets/base/main/parts.json. Each mask is a scene-resolution PNG
// where the part's polygon (treated as a closed rectangle for placeholders)
// is filled with alpha 255 and everything else is alpha 0. Color-mode parts
// also get a uniform mid-gray shading PNG.
//
// IMPORTANT: these are placeholders so the app boots end-to-end. A designer
// must replace each mask with a properly-traced, anti-aliased version and
// each shading map with the part's real luminance from the base perspective
// before shipping. See resources/reference/AUTHORING.md.
//
// Run with: npm run seed:masks

import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCENE_DIR = resolve(ROOT, "public/assets/base/main");
const PARTS_PATH = resolve(SCENE_DIR, "parts.json");
const SCENE_JSON = resolve(SCENE_DIR, "scene.json");

async function ensureDir(path) {
  await mkdir(dirname(path), { recursive: true });
}

function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function polygonBounds(polygon, width, height) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of polygon) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return {
    x0: Math.max(0, Math.floor(minX)),
    y0: Math.max(0, Math.floor(minY)),
    x1: Math.min(width, Math.ceil(maxX)),
    y1: Math.min(height, Math.ceil(maxY)),
  };
}

async function writeMask(part, width, height) {
  const buf = Buffer.alloc(width * height * 4);
  // Default alpha 0; only fill inside the polygon's bounding scan.
  const { x0, y0, x1, y1 } = polygonBounds(part.polygon, width, height);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (pointInPolygon(x + 0.5, y + 0.5, part.polygon)) {
        const i = (y * width + x) * 4;
        buf[i] = 255;
        buf[i + 1] = 255;
        buf[i + 2] = 255;
        buf[i + 3] = 255;
      }
    }
  }
  const path = resolve(SCENE_DIR, part.mask);
  await ensureDir(path);
  await sharp(buf, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(path);
  console.log(`  ✓ ${part.mask}`);
}

async function writeShading(part, width, height) {
  if (!part.shading) return;
  // PLACEHOLDER: uniform mid-gray. A real shading map encodes the part region's
  // luminance from the base perspective.
  const buf = Buffer.alloc(width * height * 4);
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = 180;
    buf[i + 1] = 180;
    buf[i + 2] = 180;
    buf[i + 3] = 255;
  }
  const path = resolve(SCENE_DIR, part.shading);
  await ensureDir(path);
  await sharp(buf, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(path);
  console.log(`  ✓ ${part.shading}`);
}

async function main() {
  const scene = JSON.parse(await readFile(SCENE_JSON, "utf-8"));
  const manifest = JSON.parse(await readFile(PARTS_PATH, "utf-8"));
  const { width, height } = scene;
  console.log(
    `Generating placeholders at ${width}x${height} for ${manifest.parts.length} parts…`,
  );
  for (const part of manifest.parts) {
    console.log(`Part ${part.id} (${part.label}) [${part.renderMode}]`);
    await writeMask(part, width, height);
    await writeShading(part, width, height);
  }
  console.log("done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
