// Extract numbered-part polygon outlines from
// resources/reference/部材対応番号-{1,2,3}.pdf by:
//
//   1. rendering each PDF at scene resolution (3000×2142)
//   2. computing pixel-wise color difference vs base.jpg → annotation pixels
//   3. classifying each annotation pixel by HSV hue (red/orange/yellow/green/blue)
//   4. detecting marker glyphs (small filled-ish circles ~50–100px) and using
//      their centroids as accurate seed positions per part (overrides any
//      placeholder marker coords in parts.json)
//   5. dilating the rest by 4px to bridge marker-induced gaps in the outline
//   6. taking connected components per (PDF, hue) on the dilated mask, then
//      for each part picking the smallest-bbox component that contains the
//      detected marker, and using its convex hull as the polygon
//
// Output: writes /tmp/parts-extracted.json (full updated manifest, with
// detected marker positions and polygons where extraction succeeded; any
// part whose polygon couldn't be extracted retains the input placeholder).
// Also writes /tmp/parts-extract-summary.json — a per-part report of what
// was promoted vs. left as placeholder, for designer review.
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
const SUMMARY = "/tmp/parts-extract-summary.json";
const exec = promisify(execFile);

// (sourcePdf, partId) → expected hue category. Manual map from a look at the
// three reference PDFs.
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

const HUE_CLS = { red: 1, orange: 2, yellow: 3, green: 4, blue: 5 };

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
  return [h, s, v];
}

function classifyHue(h, s, v) {
  if (s < 0.22 || v < 0.22) return 0;
  if (h < 15 || h >= 345) return 1; // red
  if (h < 45) return 2; // orange
  if (h < 75) return 3; // yellow
  if (h < 170) return 4; // green
  if (h < 260) return 5; // blue
  return 0;
}

async function renderPdfs() {
  await mkdir(RENDER_DIR, { recursive: true });
  for (let n = 1; n <= 3; n++) {
    await exec("pdftoppm", [
      "-r",
      "256",
      "-png",
      resolve(PDF_DIR, `部材対応番号-${n}.pdf`),
      `${RENDER_DIR}/p${n}`,
    ]);
  }
}

async function loadRendered(n, width, height) {
  const path = `${RENDER_DIR}/p${n}-1.png`;
  const { data } = await sharp(path)
    .resize(width, height, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

function buildAnnotationMap(pdfRgb, baseRgb, width, height) {
  const out = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const j = i * 3;
    const dr = pdfRgb[j] - baseRgb[j];
    const dg = pdfRgb[j + 1] - baseRgb[j + 1];
    const db = pdfRgb[j + 2] - baseRgb[j + 2];
    if (dr * dr + dg * dg + db * db < 65 * 65) continue;
    const [h, s, v] = rgb2hsv(pdfRgb[j], pdfRgb[j + 1], pdfRgb[j + 2]);
    out[i] = classifyHue(h, s, v);
  }
  return out;
}

// Square dilation of a single hue class on the annotation map.
// Returns a new Uint8Array (binary 0/1) with 1 where dilation is true.
function dilateClass(annot, hueCls, width, height, radius) {
  const src = new Uint8Array(width * height);
  for (let i = 0; i < src.length; i++) src[i] = annot[i] === hueCls ? 1 : 0;
  // Two-pass separable dilation (max filter).
  const tmp = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = 0;
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= width) continue;
        if (src[y * width + nx]) {
          v = 1;
          break;
        }
      }
      tmp[y * width + x] = v;
    }
  }
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        if (tmp[ny * width + x]) {
          v = 1;
          break;
        }
      }
      out[y * width + x] = v;
    }
  }
  return out;
}

// Connected components on a binary mask. Returns array of components with
// pixel indices, bbox, fill ratio, centroid.
function ccsOnBinary(mask, width, height) {
  const visited = new Uint8Array(width * height);
  const comps = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (visited[i] || !mask[i]) continue;
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
            if (visited[nk] || !mask[nk]) continue;
            visited[nk] = 1;
            queue.push(nk);
          }
        }
      }
      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      comps.push({
        pixels,
        bbox: { minX, minY, maxX, maxY },
        bboxArea: w * h,
        bboxW: w,
        bboxH: h,
        fill: pixels.length / (w * h),
        centroid: { x: sumX / pixels.length, y: sumY / pixels.length },
      });
    }
  }
  return comps;
}

// Detect marker-glyph candidates per hue class on the UN-dilated map.
// A marker is a roughly-square colored region ~50–100px with moderate fill.
function detectMarkers(annot, hueCls, width, height) {
  // Use small 1-px dilation to make marker pixels coherent.
  const mask = dilateClass(annot, hueCls, width, height, 1);
  const comps = ccsOnBinary(mask, width, height);
  return comps.filter((c) => {
    const aspect = Math.max(c.bboxW, c.bboxH) / Math.min(c.bboxW, c.bboxH);
    const maxDim = Math.max(c.bboxW, c.bboxH);
    return (
      maxDim >= 40 &&
      maxDim <= 110 &&
      aspect <= 1.4 &&
      c.fill >= 0.10 &&
      c.fill <= 0.55 &&
      c.pixels.length >= 200
    );
  });
}

// Convex hull (Andrew's monotone chain).
function convexHull(points) {
  const pts = [...points].sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  if (pts.length <= 1) return pts;
  const cross = (o, a, b) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    )
      lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    )
      upper.pop();
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
  await renderPdfs();

  const { data: baseRgb } = await sharp(BASE_JPG)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  // Build annotation maps + per-(PDF,hue) markers + per-(PDF,hue) dilated CCs.
  const markersByPdfHue = { 1: {}, 2: {}, 3: {} };
  const compsByPdfHue = { 1: {}, 2: {}, 3: {} };
  for (let n = 1; n <= 3; n++) {
    const pdfRgb = await loadRendered(n, width, height);
    const annot = buildAnnotationMap(pdfRgb, baseRgb, width, height);

    for (const [hueName, hueCls] of Object.entries(HUE_CLS)) {
      markersByPdfHue[n][hueName] = detectMarkers(annot, hueCls, width, height);
      // Build a dilated mask for the polygon outline detection that EXCLUDES
      // the detected marker glyph pixels so the outline doesn't get fused
      // with the marker.
      const dilated = dilateClass(annot, hueCls, width, height, 4);
      // Punch out marker pixels from the dilated mask.
      for (const m of markersByPdfHue[n][hueName]) {
        for (const k of m.pixels) dilated[k] = 0;
      }
      const comps = ccsOnBinary(dilated, width, height).filter((c) => {
        if (c.pixels.length < 400) return false;
        if (Math.min(c.bboxW, c.bboxH) < 25) return false;
        return true;
      });
      compsByPdfHue[n][hueName] = comps;
    }
    console.log(
      `PDF ${n}: ${Object.entries(markersByPdfHue[n])
        .map(([k, v]) => `${k}_marker=${v.length}`)
        .join(" ")}`,
    );
    console.log(
      `       ${Object.entries(compsByPdfHue[n])
        .map(([k, v]) => `${k}_outline=${v.length}`)
        .join(" ")}`,
    );
  }

  // For each part, find its detected marker + its polygon outline.
  const out = JSON.parse(JSON.stringify(manifest));
  const summary = [];
  for (const part of out.parts) {
    const key = `${part.sourcePdf}:${part.id}`;
    const hueName = PART_HUE[key];
    const report = {
      partId: part.id,
      label: part.label,
      sourcePdf: part.sourcePdf,
      hueName,
      markerOriginal: { ...part.marker },
      markerExtracted: null,
      polygonExtracted: false,
      polygonVertices: 0,
      bbox: null,
      reason: null,
    };
    if (!hueName) {
      report.reason = "no hue mapping for part";
      summary.push(report);
      continue;
    }

    // 1) Find the marker glyph closest to the placeholder marker position.
    const markers = markersByPdfHue[part.sourcePdf][hueName] ?? [];
    let bestMarker = null;
    let bestMarkerD = Infinity;
    for (const m of markers) {
      const dx = m.centroid.x - part.marker.x;
      const dy = m.centroid.y - part.marker.y;
      const d = dx * dx + dy * dy;
      if (d < bestMarkerD) {
        bestMarkerD = d;
        bestMarker = m;
      }
    }
    if (bestMarker && Math.sqrt(bestMarkerD) < 600) {
      part.marker = {
        x: Math.round(bestMarker.centroid.x),
        y: Math.round(bestMarker.centroid.y),
      };
      report.markerExtracted = { ...part.marker };
    } else {
      report.reason = "no nearby marker glyph detected";
    }

    // 2) Find the polygon outline component closest to the (now-updated) marker.
    const comps = compsByPdfHue[part.sourcePdf][hueName] ?? [];
    const containing = comps.filter((c) => {
      const pad = 60;
      return (
        part.marker.x >= c.bbox.minX - pad &&
        part.marker.x <= c.bbox.maxX + pad &&
        part.marker.y >= c.bbox.minY - pad &&
        part.marker.y <= c.bbox.maxY + pad
      );
    });
    let best;
    if (containing.length) {
      // Smallest bbox area that contains the marker (most specific outline).
      containing.sort((a, b) => a.bboxArea - b.bboxArea);
      best = containing[0];
    } else {
      // Fallback: nearest centroid within 350px.
      const sorted = comps
        .map((c) => {
          const dx = c.centroid.x - part.marker.x;
          const dy = c.centroid.y - part.marker.y;
          return { c, d: Math.sqrt(dx * dx + dy * dy) };
        })
        .filter((x) => x.d < 350)
        .sort((a, b) => a.d - b.d);
      best = sorted[0]?.c;
    }

    if (!best) {
      report.reason = report.reason ?? "no candidate outline";
      summary.push(report);
      continue;
    }

    // 3) Sanity: bbox must be at least 100×100, otherwise we're picking up
    // sliver / leftover marker fragments.
    if (Math.min(best.bboxW, best.bboxH) < 60) {
      report.reason = `outline candidate too small (${best.bboxW}×${best.bboxH})`;
      summary.push(report);
      continue;
    }

    const points = best.pixels.map((k) => {
      const py = Math.floor(k / width);
      const px = k - py * width;
      return [px, py];
    });
    const hull = convexHull(points);
    // Decimate to <= 24 vertices.
    const stride = Math.max(1, Math.ceil(hull.length / 24));
    const decimated = hull.filter((_, idx) => idx % stride === 0);
    part.polygon = decimated.map(([x, y]) => [Math.round(x), Math.round(y)]);
    report.polygonExtracted = true;
    report.polygonVertices = decimated.length;
    report.bbox = {
      x0: best.bbox.minX,
      y0: best.bbox.minY,
      x1: best.bbox.maxX,
      y1: best.bbox.maxY,
      w: best.bboxW,
      h: best.bboxH,
    };
    summary.push(report);
  }

  await writeFile(OUT, JSON.stringify(out, null, 2));
  await writeFile(SUMMARY, JSON.stringify(summary, null, 2));

  // Console report.
  const promoted = summary.filter((s) => s.polygonExtracted).length;
  const markerUpdates = summary.filter((s) => s.markerExtracted).length;
  console.log(`\nResult: ${promoted}/${summary.length} polygons extracted, ${markerUpdates} markers detected`);
  for (const s of summary) {
    if (s.polygonExtracted) {
      console.log(
        `  ✓ ${s.partId} (${s.hueName}): ${s.polygonVertices}pt, bbox ${s.bbox.w}×${s.bbox.h}, marker → (${s.markerExtracted?.x ?? "?"}, ${s.markerExtracted?.y ?? "?"})`,
      );
    } else {
      console.log(`  ! ${s.partId} (${s.hueName ?? "?"}): ${s.reason}`);
    }
  }
  console.log(`\n✓ wrote ${OUT}`);
  console.log(`✓ wrote ${SUMMARY}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
