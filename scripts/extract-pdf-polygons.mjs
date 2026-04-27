// Experimental: extract numbered-part polygon outlines from
// resources/reference/部材対応番号-{1,2,3}.pdf by color-filtering pixels that
// differ significantly from base.jpg, grouping into connected components,
// classifying by hue, and approximating each component as a polygon.
//
// Output: writes updated polygons to /tmp/parts-extracted.json for review.
// Does NOT touch public/assets/base/main/parts.json — designer reviews
// extracted polygons against the source PDFs and approves before promotion.
//
// Usage: node scripts/extract-pdf-polygons.mjs

import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCENE_DIR = resolve(ROOT, "public/assets/base/main");
const PARTS_PATH = resolve(SCENE_DIR, "parts.json");
const SCENE_JSON = resolve(SCENE_DIR, "scene.json");
const BASE_JPG = resolve(SCENE_DIR, "base.jpg");
const PDF_DIR = resolve(ROOT, "resources/reference");
const RENDER_DIR = "/tmp/pdf-render";
const OUT = "/tmp/parts-extracted.json";
const exec = promisify(execFile);

// HSV hue ranges per category color used on the PDFs.
// (Approximate; tweak as needed.)
const HUE_RANGES = {
  red: { min: 0, max: 15, satMin: 0.4 },
  orange: { min: 15, max: 40, satMin: 0.4 },
  yellow: { min: 40, max: 75, satMin: 0.25 },
  green: { min: 90, max: 160, satMin: 0.3 },
  blue: { min: 180, max: 255, satMin: 0.3 },
};

// Map (sourcePdf, partId) → expected hue category. Derived from a manual look
// at the three reference PDFs.
const PART_HUE = {
  // PDF 1
  "1:07": "green",
  "1:09": "red",
  "1:10": "yellow",
  "1:13": "blue",
  // PDF 2
  "2:12": "orange",
  "2:14": "blue",
  "2:15": "green",
  "2:16": "orange",
  "2:17": "red",
  // PDF 3
  "3:01": "red",
  "3:02": "blue",
  "3:03": "orange",
  "3:04": "blue",
  "3:05": "orange",
  "3:06": "orange",
  "3:08": "green",
  "3:11": "orange",
};

function rgb2hsv(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === rn) h = ((gn - bn) / d) % 6;
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const s = max === 0 ? 0 : d / max;
  const v = max;
  // Encode hue as 0..255 for compactness in callers.
  return [Math.round((h / 360) * 255), s, v];
}

async function renderPdfs(width, height) {
  await mkdir(RENDER_DIR, { recursive: true });
  // Use pdftoppm at the scene resolution (will be a few px off due to PDF
  // aspect; we'll resize to exact afterwards).
  const dpi = 256;
  for (let n = 1; n <= 3; n++) {
    const out = `${RENDER_DIR}/p${n}`;
    await exec("pdftoppm", [
      "-r",
      String(dpi),
      "-png",
      resolve(PDF_DIR, `部材対応番号-${n}.pdf`),
      out,
    ]);
  }
}

async function loadRendered(n, width, height) {
  // pdftoppm names files <prefix>-1.png for single-page PDFs.
  const path = `${RENDER_DIR}/p${n}-1.png`;
  const { data, info } = await sharp(path)
    .resize(width, height, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

// Difference per pixel between PDF render and base; classify hue.
// Returns a Uint8Array (width*height) where each cell is a hue-class index
// (0 = none, 1 = red, 2 = orange, 3 = yellow, 4 = green, 5 = blue).
function buildAnnotationMap(pdfRgb, baseRgb, width, height) {
  const out = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const j = i * 3;
    const dr = pdfRgb[j] - baseRgb[j];
    const dg = pdfRgb[j + 1] - baseRgb[j + 1];
    const db = pdfRgb[j + 2] - baseRgb[j + 2];
    const dist2 = dr * dr + dg * dg + db * db;
    if (dist2 < 70 * 70) continue; // not an annotation pixel
    const [h255, s, v] = rgb2hsv(pdfRgb[j], pdfRgb[j + 1], pdfRgb[j + 2]);
    if (s < 0.25 || v < 0.25) continue;
    const hue = (h255 / 255) * 360;
    let cls = 0;
    if (hue < 15 || hue >= 345) cls = 1; // red
    else if (hue < 45) cls = 2; // orange
    else if (hue < 75) cls = 3; // yellow
    else if (hue < 170) cls = 4; // green
    else if (hue < 260) cls = 5; // blue
    out[i] = cls;
  }
  return out;
}

const HUE_CLS = { red: 1, orange: 2, yellow: 3, green: 4, blue: 5 };

// Connected components by 8-neighbor on a single hue class. Returns array of
// { pixels: number[] (indices), bbox, centroid }.
function connectedComponents(annot, hueCls, width, height) {
  const visited = new Uint8Array(width * height);
  const comps = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (visited[i] || annot[i] !== hueCls) continue;
      // BFS
      const queue = [i];
      visited[i] = 1;
      const pixels = [];
      let minX = x;
      let minY = y;
      let maxX = x;
      let maxY = y;
      let sumX = 0;
      let sumY = 0;
      while (queue.length) {
        const k = queue.pop();
        const cy = Math.floor(k / width);
        const cx = k - cy * width;
        pixels.push(k);
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        sumX += cx;
        sumY += cy;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const nk = ny * width + nx;
            if (visited[nk] || annot[nk] !== hueCls) continue;
            visited[nk] = 1;
            queue.push(nk);
          }
        }
      }
      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      const fill = pixels.length / (w * h);
      // Skip noise.
      if (pixels.length < 80) continue;
      // Skip the small numbered-marker glyphs: a marker is a roughly square
      // (filled or thick-stroked) circle, ~40–90 px on each side, with high
      // fill ratio. The polygon outline, by contrast, is a thin curve with
      // a large bbox and low fill.
      const aspect = Math.max(w, h) / Math.min(w, h);
      const isLikelyMarker =
        Math.max(w, h) < 110 && aspect < 1.6 && fill > 0.18;
      if (isLikelyMarker) continue;
      // Skip very thin line fragments (sliver artifacts from misalignment).
      if (Math.min(w, h) < 8) continue;
      comps.push({
        pixels,
        bbox: { minX, minY, maxX, maxY },
        bboxArea: w * h,
        fill,
        centroid: { x: sumX / pixels.length, y: sumY / pixels.length },
      });
    }
  }
  return comps;
}

// Convex hull of a set of (x,y) points (Andrew's monotone chain).
function convexHull(points) {
  const pts = [...points].sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  if (pts.length <= 1) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

async function main() {
  const scene = JSON.parse(await readFile(SCENE_JSON, "utf-8"));
  const manifest = JSON.parse(await readFile(PARTS_PATH, "utf-8"));
  const { width, height } = scene;

  console.log(`Rendering PDFs at ${width}×${height}…`);
  await renderPdfs(width, height);

  const { data: baseRgb } = await sharp(BASE_JPG)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Build annotation maps + per-hue-class component sets per PDF.
  const components = { 1: {}, 2: {}, 3: {} };
  for (let n = 1; n <= 3; n++) {
    const pdfRgb = await loadRendered(n, width, height);
    const annot = buildAnnotationMap(pdfRgb, baseRgb, width, height);
    for (const [hueName, hueCls] of Object.entries(HUE_CLS)) {
      components[n][hueName] = connectedComponents(annot, hueCls, width, height);
    }
    console.log(
      `PDF ${n}: ${Object.entries(components[n])
        .map(([k, v]) => `${k}=${v.length}`)
        .join(" ")}`,
    );
  }

  // For each part, find the matching component (nearest centroid to marker).
  const out = JSON.parse(JSON.stringify(manifest));
  let updated = 0;
  let missing = 0;
  for (const part of out.parts) {
    const key = `${part.sourcePdf}:${part.id}`;
    const hueName = PART_HUE[key];
    if (!hueName) continue;
    const comps = components[part.sourcePdf][hueName] ?? [];
    if (!comps.length) {
      console.log(`! part ${part.id} (${hueName}): no components found in PDF ${part.sourcePdf}`);
      missing++;
      continue;
    }
    // Prefer components whose bbox CONTAINS the marker (with small padding).
    // Among those, pick the SMALLEST bbox — that's the most specific outline
    // for this part. This handles the common case of one PDF having many
    // same-colored parts (e.g. PDF-3 orange has ③ ⑤ ⑥ ⑪).
    // Also reject components whose bbox is degenerate (a thin line) — real
    // outlines have a non-trivial aspect ratio.
    const containing = comps.filter((c) => {
      const pad = 40;
      const w = c.bbox.maxX - c.bbox.minX + 1;
      const h = c.bbox.maxY - c.bbox.minY + 1;
      if (Math.min(w, h) < 30) return false; // skip line-like fragments
      return (
        part.marker.x >= c.bbox.minX - pad &&
        part.marker.x <= c.bbox.maxX + pad &&
        part.marker.y >= c.bbox.minY - pad &&
        part.marker.y <= c.bbox.maxY + pad
      );
    });
    let best;
    if (containing.length) {
      containing.sort((a, b) => a.bboxArea - b.bboxArea);
      best = containing[0];
    } else {
      // Fallback: nearest component centroid within 400px, ignoring lines.
      const candidates = comps
        .filter((c) => {
          const w = c.bbox.maxX - c.bbox.minX + 1;
          const h = c.bbox.maxY - c.bbox.minY + 1;
          return Math.min(w, h) >= 30;
        })
        .map((c) => {
          const dx = c.centroid.x - part.marker.x;
          const dy = c.centroid.y - part.marker.y;
          return { c, d: Math.sqrt(dx * dx + dy * dy) };
        })
        .filter((x) => x.d < 400)
        .sort((a, b) => a.d - b.d);
      best = candidates[0]?.c;
    }
    if (!best) {
      console.log(`! part ${part.id} (${hueName}): no candidate components`);
      missing++;
      continue;
    }
    // Build polygon: convex hull of the component pixels, then decimate.
    const points = best.pixels.map((k) => {
      const py = Math.floor(k / width);
      const px = k - py * width;
      return [px, py];
    });
    const hull = convexHull(points);
    // Decimate to <= 24 vertices for compactness.
    const stride = Math.max(1, Math.ceil(hull.length / 24));
    const decimated = hull.filter((_, idx) => idx % stride === 0);
    part.polygon = decimated.map(([x, y]) => [Math.round(x), Math.round(y)]);
    updated++;
    console.log(
      `  ✓ part ${part.id} (${hueName}): hull=${hull.length}pt → ${decimated.length}pt, bbox ${best.bbox.minX},${best.bbox.minY}–${best.bbox.maxX},${best.bbox.maxY}`,
    );
  }

  await writeFile(OUT, JSON.stringify(out, null, 2));
  console.log(`\n✓ wrote ${OUT} (updated ${updated}, missing ${missing})`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
