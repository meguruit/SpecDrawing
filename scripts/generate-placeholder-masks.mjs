// Generates alpha masks for every part in public/assets/base/main/parts.json,
// and real grayscale shading maps for color-mode parts derived from base.jpg.
//
// Mask: scene-resolution PNG, alpha 255 inside the part polygon, 0 outside,
// with a 2-pixel Gaussian feather on the edges to avoid stair-step artifacts.
//
// Shading (color-mode parts only): scene-resolution PNG. The part region's
// luminance is sampled from base.jpg (Rec.709 grayscale of the masked pixels).
// Outside the mask the pixel stays mid-gray (irrelevant since the runtime
// clips by the same mask).
//
// IMPORTANT: polygons in parts.json are PLACEHOLDER rectangles authored from
// visual reference of the 部材対応番号 PDFs. Designer must trace the real
// outlines (use the /dev/trace tool). Once polygons are accurate, re-running
// this script will produce production-quality masks and shading.
//
// Run with: npm run seed:masks

import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC_DIR = resolve(ROOT, "public");
const SCENE_DIR = resolve(ROOT, "public/assets/base/main");
const PARTS_PATH = resolve(SCENE_DIR, "parts.json");
const SCENE_JSON = resolve(SCENE_DIR, "scene.json");

const MASK_FEATHER_RADIUS = 2; // pixels — Gaussian sigma for edge anti-aliasing

async function ensureDir(path) {
  await mkdir(dirname(path), { recursive: true });
}

function pointInRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Even-odd fill across every ring of every polygon entry. Outer adds 1,
// each hole adds 1 — odd count = inside.
function pointInPolygons(x, y, polygons) {
  let count = 0;
  for (const poly of polygons) {
    if (pointInRing(x, y, poly.outer)) count++;
    if (poly.holes) {
      for (const hole of poly.holes) {
        if (pointInRing(x, y, hole)) count++;
      }
    }
  }
  return (count & 1) === 1;
}

// Accept both legacy `polygon: Vertex[]` and new `polygons: [{outer, holes?}]`.
// Returns the runtime `polygons` shape.
function getPolygons(part) {
  if (Array.isArray(part.polygons)) return part.polygons;
  if (Array.isArray(part.polygon)) return [{ outer: part.polygon }];
  throw new Error(`part ${part.id} has neither polygons nor polygon`);
}

function polygonsBounds(polygons, width, height) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of polygons) {
    for (const [x, y] of poly.outer) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return {
    x0: Math.max(0, Math.floor(minX) - MASK_FEATHER_RADIUS * 2),
    y0: Math.max(0, Math.floor(minY) - MASK_FEATHER_RADIUS * 2),
    x1: Math.min(width, Math.ceil(maxX) + MASK_FEATHER_RADIUS * 2),
    y1: Math.min(height, Math.ceil(maxY) + MASK_FEATHER_RADIUS * 2),
  };
}

// Build a hard alpha mask from every ring, then feather with Gaussian blur.
// Returns the rasterized RGBA buffer (alpha-only) at scene resolution.
function rasterizePolygonsMask(polygons, width, height) {
  const buf = Buffer.alloc(width * height * 4);
  const { x0, y0, x1, y1 } = polygonsBounds(polygons, width, height);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (pointInPolygons(x + 0.5, y + 0.5, polygons)) {
        const i = (y * width + x) * 4;
        buf[i] = 255;
        buf[i + 1] = 255;
        buf[i + 2] = 255;
        buf[i + 3] = 255;
      }
    }
  }
  return buf;
}

async function writeMask(part, width, height) {
  const polygons = getPolygons(part);
  const raw = rasterizePolygonsMask(polygons, width, height);
  const path = resolve(SCENE_DIR, part.mask);
  await ensureDir(path);
  // Apply Gaussian blur to feather the alpha edge.
  await sharp(raw, { raw: { width, height, channels: 4 } })
    .blur(MASK_FEATHER_RADIUS)
    .png({ compressionLevel: 9 })
    .toFile(path);
  console.log(`  ✓ ${part.mask}`);
}

// Compute a shading map for a color-mode part from base.jpg:
// for every pixel inside the polygon, write the pixel's Rec.709 luminance
// (grayscale of the base perspective at that point). Outside the polygon
// stays mid-gray (180) — the runtime clips by the mask anyway.
async function writeShading(part, baseRgb, width, height) {
  if (!part.shading) return;
  const polygons = getPolygons(part);
  const out = Buffer.alloc(width * height * 4);
  // Mid-gray default outside the polygons.
  for (let i = 0; i < out.length; i += 4) {
    out[i] = 180;
    out[i + 1] = 180;
    out[i + 2] = 180;
    out[i + 3] = 255;
  }
  const { x0, y0, x1, y1 } = polygonsBounds(polygons, width, height);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (pointInPolygons(x + 0.5, y + 0.5, polygons)) {
        const j = (y * width + x) * 3;
        const r = baseRgb[j];
        const g = baseRgb[j + 1];
        const b = baseRgb[j + 2];
        // Rec.709 luminance.
        const lum = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
        const i = (y * width + x) * 4;
        out[i] = lum;
        out[i + 1] = lum;
        out[i + 2] = lum;
        out[i + 3] = 255;
      }
    }
  }
  const path = resolve(SCENE_DIR, part.shading);
  await ensureDir(path);
  await sharp(out, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(path);
  console.log(`  ✓ ${part.shading} (real luminance)`);
}

async function main() {
  const scene = JSON.parse(await readFile(SCENE_JSON, "utf-8"));
  const manifest = JSON.parse(await readFile(PARTS_PATH, "utf-8"));
  const { width, height } = scene;

  // The base image filename is sourced from scene.json (`baseImageUrl`),
  // not hardcoded — follows the natural/sharp/flat variant rename.
  const baseImageUrl = scene.baseImageUrl;
  if (typeof baseImageUrl !== "string") {
    throw new Error("scene.json is missing a string `baseImageUrl`");
  }
  const baseJpgPath = resolve(PUBLIC_DIR, baseImageUrl.replace(/^\//, ""));

  const { data: baseRgb, info: baseInfo } = await sharp(baseJpgPath)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (baseInfo.width !== width || baseInfo.height !== height) {
    throw new Error(
      `base image dimensions (${baseInfo.width}x${baseInfo.height}) do not match scene.json (${width}x${height})`,
    );
  }

  console.log(
    `Generating masks (feather=${MASK_FEATHER_RADIUS}px) and shading at ${width}x${height} for ${manifest.parts.length} parts…`,
  );
  for (const part of manifest.parts) {
    console.log(`Part ${part.id} (${part.label}) [${part.renderMode}]`);
    await writeMask(part, width, height);
    await writeShading(part, baseRgb, width, height);
  }
  console.log("done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
