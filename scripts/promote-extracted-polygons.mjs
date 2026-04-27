// One-shot script: merge polygons + markers from /tmp/parts-extracted.json
// (output of scripts/extract-pdf-polygons.mjs) into the live parts.json.
//
// Promotion policy (designer-curated, after reviewing extraction quality):
//   - Promote polygons for parts whose extracted bbox plausibly matches the
//     real region (② ⑦ ⑬ ⑮).
//   - Promote markers for parts whose extracted glyph centroid looks
//     consistent with the perspective (① ③ ④ ⑤ ⑧ ⑭).
//   - For all other parts, use a hand-tuned rectangle authored from a visual
//     read of base.jpg (the four-vertex polygons below). Designer can refine
//     each via /dev/trace.
//
// After this script runs, re-run `npm run seed:masks` to regenerate masks +
// shading from the new polygons.
//
// Usage: node scripts/promote-extracted-polygons.mjs

import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LIVE = resolve(ROOT, "public/assets/base/main/parts.json");
const EXTRACTED = "/tmp/parts-extracted.json";

// Extracted polygons to PROMOTE wholesale (designer reviewed, look right).
const PROMOTE_POLYGON = new Set(["02", "07", "13", "15"]);

// Extracted markers to PROMOTE (designer reviewed, look right).
const PROMOTE_MARKER = new Set(["01", "03", "04", "05", "08", "14"]);

// Hand-tuned rectangle polygons for parts where extraction failed or grabbed
// the wrong region. Read off base.jpg (3000×2142) by visual inspection.
const HAND_TUNED = {
  "01": [[1450, 1180], [2200, 1180], [2200, 1260], [1450, 1260]],
  "03": [[1605, 1230], [1740, 1230], [1740, 1320], [1605, 1320]],
  "04": [[1500, 1080], [1680, 1080], [1680, 1230], [1500, 1230]],
  "05": [[1490, 815], [1740, 815], [1740, 1140], [1490, 1140]],
  "06": [[1760, 740], [2160, 740], [2160, 1075], [1760, 1075]],
  "08": [[1430, 1250], [2200, 1250], [2200, 1730], [1430, 1730]],
  "09": [[240, 90], [2580, 90], [2580, 470], [240, 470]],
  "10": [[2225, 760], [2475, 760], [2475, 1680], [2225, 1680]],
  "11": [[2435, 1300], [2480, 1300], [2480, 1340], [2435, 1340]],
  "12": [[2280, 1700], [2780, 1700], [2780, 2020], [2280, 2020]],
  "14": [[2645, 1300], [2680, 1300], [2680, 1340], [2645, 1340]],
  "16": [[1320, 380], [1430, 380], [1430, 1640], [1320, 1640]],
  "17": [[640, 270], [1260, 270], [1260, 870], [640, 870]],
};

// Hand-tuned marker positions where the extractor either didn't detect or
// pulled the wrong glyph. (Otherwise, use the extracted marker.)
const HAND_TUNED_MARKER = {
  "06": { x: 1960, y: 920 },
  "07": { x: 1920, y: 1020 },
  "09": { x: 1410, y: 280 },
  "10": { x: 2350, y: 1220 },
  "11": { x: 2455, y: 1320 },
  "12": { x: 2530, y: 1860 },
  "13": { x: 2640, y: 1220 },
  "14": { x: 2660, y: 1320 },
  "15": { x: 1150, y: 1900 },
  "16": { x: 1375, y: 1010 },
  "17": { x: 950, y: 570 },
};

async function main() {
  const live = JSON.parse(await readFile(LIVE, "utf-8"));
  const extracted = JSON.parse(await readFile(EXTRACTED, "utf-8"));
  const extById = new Map(extracted.parts.map((p) => [p.id, p]));

  let polyPromoted = 0;
  let markerPromoted = 0;
  let polyHand = 0;
  let markerHand = 0;

  for (const part of live.parts) {
    const ex = extById.get(part.id);
    // Polygon
    if (PROMOTE_POLYGON.has(part.id) && ex && ex.polygon.length >= 4) {
      part.polygon = ex.polygon;
      polyPromoted++;
    } else if (HAND_TUNED[part.id]) {
      part.polygon = HAND_TUNED[part.id];
      polyHand++;
    }
    // Marker
    if (PROMOTE_MARKER.has(part.id) && ex && ex.marker) {
      part.marker = ex.marker;
      markerPromoted++;
    } else if (HAND_TUNED_MARKER[part.id]) {
      part.marker = HAND_TUNED_MARKER[part.id];
      markerHand++;
    }
  }

  await writeFile(LIVE, JSON.stringify(live, null, 2) + "\n");
  console.log(
    `Polygons: ${polyPromoted} promoted from extractor, ${polyHand} hand-tuned`,
  );
  console.log(
    `Markers:  ${markerPromoted} promoted from extractor, ${markerHand} hand-tuned`,
  );
  console.log(`Wrote ${LIVE}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
