// Walks every option on the primary sheet for a list of focus parts and
// prints a concise table to spot label/icon/texture mismatches. Surfaces:
//   - options without an iconUrl
//   - options whose iconUrl file is missing on disk
//   - texture-mode options without textureUrlByVariant
//   - texture-mode options whose iconUrl dominant color diverges from
//     the dominant color of their textureUrl PNG (a heuristic for
//     "label says X but texture is Y")
//
// Run with: node scripts/audit-finish-options.mjs [partIds...]
//   default partIds: 02 10 11 13 14 15 17

import sharp from "sharp";
import { readFile, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OPTIONS_JSON = resolve(ROOT, "public/catalog/finish-options.json");
const PRIMARY_SHEET = "アーバンシー";

const FOCUS = process.argv.slice(2);
const FOCUS_SET = new Set(FOCUS.length > 0 ? FOCUS : ["02", "10", "11", "13", "14", "15", "17"]);

async function exists(path) {
  try { await stat(path); return true; } catch { return false; }
}

async function dominantNonWhite(path) {
  const { data, info } = await sharp(path).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let sumR = 0, sumG = 0, sumB = 0, kept = 0;
  for (let i = 0; i < info.width * info.height; i++) {
    const r = data[i * 3];
    const g = data[i * 3 + 1];
    const b = data[i * 3 + 2];
    if (r > 240 && g > 240 && b > 240) continue;
    sumR += r; sumG += g; sumB += b; kept++;
  }
  if (kept === 0) return null;
  return { r: Math.round(sumR / kept), g: Math.round(sumG / kept), b: Math.round(sumB / kept) };
}

function rgbDist(a, b) {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}
function hex(c) {
  if (!c) return "—";
  return `#${[c.r, c.g, c.b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

async function main() {
  const file = JSON.parse(await readFile(OPTIONS_JSON, "utf-8"));
  const options = file.options.filter(
    (o) => o.sheet === PRIMARY_SHEET && FOCUS_SET.has(o.partId),
  );
  options.sort((a, b) => a.partId.localeCompare(b.partId) || a.id.localeCompare(b.id));

  const findings = [];
  for (const opt of options) {
    if (!opt.iconUrl) {
      findings.push({ id: opt.id, partId: opt.partId, label: opt.label, kind: "no-iconUrl" });
      continue;
    }
    const iconAbs = resolve(ROOT, "public", opt.iconUrl.replace(/^\//, ""));
    if (!(await exists(iconAbs))) {
      findings.push({ id: opt.id, partId: opt.partId, label: opt.label, kind: "iconUrl-missing", path: opt.iconUrl });
      continue;
    }
    const iconColor = await dominantNonWhite(iconAbs);
    if (opt.colorHex) {
      // color-mode: compare iconUrl to colorHex
      const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(opt.colorHex);
      if (m && iconColor) {
        const hexC = { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
        const d = rgbDist(iconColor, hexC);
        if (d > 80) {
          findings.push({
            id: opt.id, partId: opt.partId, label: opt.label,
            kind: "color-mode-mismatch", iconHex: hex(iconColor), colorHex: opt.colorHex, dist: Math.round(d),
          });
        }
      }
      continue;
    }
    // texture-mode: compare iconUrl to textureUrl dominant color
    if (!opt.textureUrl) {
      findings.push({ id: opt.id, partId: opt.partId, label: opt.label, kind: "no-textureUrl" });
      continue;
    }
    const textureAbs = resolve(ROOT, "public", opt.textureUrl.replace(/^\//, ""));
    if (!(await exists(textureAbs))) {
      findings.push({ id: opt.id, partId: opt.partId, label: opt.label, kind: "textureUrl-missing", path: opt.textureUrl });
      continue;
    }
    const texColor = await dominantNonWhite(textureAbs);
    if (iconColor && texColor) {
      const d = rgbDist(iconColor, texColor);
      if (d > 80) {
        findings.push({
          id: opt.id, partId: opt.partId, label: opt.label,
          kind: "texture-mode-mismatch", iconHex: hex(iconColor), texHex: hex(texColor), dist: Math.round(d),
        });
      }
    }
  }

  console.log(`\nAudited ${options.length} option(s) on ${PRIMARY_SHEET} for parts [${[...FOCUS_SET].sort().join(", ")}]`);
  console.log(`Findings: ${findings.length}\n`);
  for (const f of findings) {
    if (f.kind === "color-mode-mismatch") {
      console.log(`  ⚠ ${f.partId} ${f.id} "${f.label}" — color-mode label↔hex distance ${f.dist} (icon=${f.iconHex}, hex=${f.colorHex})`);
    } else if (f.kind === "texture-mode-mismatch") {
      console.log(`  ⚠ ${f.partId} ${f.id} "${f.label}" — texture↔icon distance ${f.dist} (icon=${f.iconHex}, tex=${f.texHex})`);
    } else {
      console.log(`  ⚠ ${f.partId} ${f.id} "${f.label}" — ${f.kind}${f.path ? ` (${f.path})` : ""}`);
    }
  }
  if (findings.length === 0) {
    console.log("  (no issues found at distance threshold 80; tune threshold via the constant in the script)");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
