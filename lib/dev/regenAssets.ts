// Server-only mask + shading regeneration for /dev/trace's autosave path.
// Mirrors the logic of scripts/generate-placeholder-masks.mjs but is
// callable from the Next.js dev API. Uses Node fs + sharp.
//
// Mask: scene-resolution PNG, alpha 255 inside the part region, 0 outside,
// with a 2-pixel Gaussian feather on the edge. The "inside" of a part is
// computed via even-odd fill across every ring of every entry in
// `part.polygons` — outer rings contribute, hole rings subtract.
// Shading (color-mode parts only): scene-resolution PNG. The masked region
// holds the Rec.709 luminance from base.jpg; outside the polygons the
// pixel stays mid-gray (irrelevant — runtime clips by the same mask).

import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Part, Polygon, Vertex } from "@/lib/parts/types";

const MASK_FEATHER_RADIUS = 2;

function pointInRing(x: number, y: number, ring: ReadonlyArray<Vertex>): boolean {
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

// Even-odd fill across every ring: a point is inside iff the count of
// rings containing it is odd. With well-formed `{ outer, holes }`, the
// outer alone is 1 (inside) and a hole adds +1 → 2 (outside) → matches
// "outer minus hole" intent without needing a separate subtract pass.
function pointInPolygons(
  x: number,
  y: number,
  polygons: ReadonlyArray<Polygon>,
): boolean {
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

function polygonsBounds(
  polygons: ReadonlyArray<Polygon>,
  width: number,
  height: number,
) {
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

function rasterizePolygonsMask(
  polygons: ReadonlyArray<Polygon>,
  width: number,
  height: number,
): Buffer {
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

async function ensureDir(filePath: string) {
  await mkdir(dirname(filePath), { recursive: true });
}

async function writeMaskPng(
  part: Part,
  sceneDir: string,
  width: number,
  height: number,
) {
  const raw = rasterizePolygonsMask(part.polygons, width, height);
  const path = resolve(sceneDir, part.mask);
  await ensureDir(path);
  // Gaussian blur on the alpha buffer — same 1-pixel-half-coverage edge AA
  // as the prior single-polygon rasterizer.
  await sharp(raw, { raw: { width, height, channels: 4 } })
    .blur(MASK_FEATHER_RADIUS)
    .png({ compressionLevel: 9 })
    .toFile(path);
}

async function writeShadingPng(
  part: Part,
  sceneDir: string,
  baseRgb: Buffer,
  width: number,
  height: number,
) {
  if (!part.shading) return;
  const out = Buffer.alloc(width * height * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = 180;
    out[i + 1] = 180;
    out[i + 2] = 180;
    out[i + 3] = 255;
  }
  const { x0, y0, x1, y1 } = polygonsBounds(part.polygons, width, height);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (pointInPolygons(x + 0.5, y + 0.5, part.polygons)) {
        const j = (y * width + x) * 3;
        const r = baseRgb[j];
        const g = baseRgb[j + 1];
        const b = baseRgb[j + 2];
        const lum = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
        const i = (y * width + x) * 4;
        out[i] = lum;
        out[i + 1] = lum;
        out[i + 2] = lum;
        out[i + 3] = 255;
      }
    }
  }
  const path = resolve(sceneDir, part.shading);
  await ensureDir(path);
  await sharp(out, { raw: { width, height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(path);
}

export type RegenInput = {
  sceneDir: string;
  width: number;
  height: number;
  baseRgb: Buffer;
  parts: ReadonlyArray<Part>;
};

export async function regenPartsAssets(input: RegenInput): Promise<void> {
  for (const part of input.parts) {
    await writeMaskPng(part, input.sceneDir, input.width, input.height);
    await writeShadingPng(
      part,
      input.sceneDir,
      input.baseRgb,
      input.width,
      input.height,
    );
  }
}
