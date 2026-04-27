// Server-only mask + shading regeneration for /dev/trace's autosave path.
// Mirrors the logic of scripts/generate-placeholder-masks.mjs but is
// callable from the Next.js dev API. Uses Node fs + sharp.
//
// Mask: scene-resolution PNG, alpha 255 inside the polygon, 0 outside,
// with a 2-pixel Gaussian feather on the edge.
// Shading (color-mode parts only): scene-resolution PNG. The masked region
// holds the Rec.709 luminance from base.jpg; outside the polygon stays
// mid-gray (irrelevant since the runtime clips by the same mask).

import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { Part } from "@/lib/parts/types";

const MASK_FEATHER_RADIUS = 2;

function pointInPolygon(
  x: number,
  y: number,
  polygon: ReadonlyArray<[number, number]>,
): boolean {
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

function polygonBounds(
  polygon: ReadonlyArray<[number, number]>,
  width: number,
  height: number,
) {
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
    x0: Math.max(0, Math.floor(minX) - MASK_FEATHER_RADIUS * 2),
    y0: Math.max(0, Math.floor(minY) - MASK_FEATHER_RADIUS * 2),
    x1: Math.min(width, Math.ceil(maxX) + MASK_FEATHER_RADIUS * 2),
    y1: Math.min(height, Math.ceil(maxY) + MASK_FEATHER_RADIUS * 2),
  };
}

function rasterizePolygonMask(
  polygon: ReadonlyArray<[number, number]>,
  width: number,
  height: number,
): Buffer {
  const buf = Buffer.alloc(width * height * 4);
  const { x0, y0, x1, y1 } = polygonBounds(polygon, width, height);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (pointInPolygon(x + 0.5, y + 0.5, polygon)) {
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
  const raw = rasterizePolygonMask(
    part.polygon as ReadonlyArray<[number, number]>,
    width,
    height,
  );
  const path = resolve(sceneDir, part.mask);
  await ensureDir(path);
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
  const { x0, y0, x1, y1 } = polygonBounds(
    part.polygon as ReadonlyArray<[number, number]>,
    width,
    height,
  );
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (
        pointInPolygon(
          x + 0.5,
          y + 0.5,
          part.polygon as ReadonlyArray<[number, number]>,
        )
      ) {
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

/**
 * Regenerate mask + shading PNGs for the given parts.
 * Sequential (sharp is fast enough; parallel would race the disk).
 */
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
