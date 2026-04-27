// Extract finish options from resources/catalog/部材リスト.xlsx and emit:
//   public/catalog/finish-options.json
//   public/catalog/finish-options.warnings.json
//   public/assets/finishes/<part-id>/<option-id>.png   (one per option swatch)
//
// The workbook has two sheets (アーバンシー / レコリード). Each sheet enumerates
// numbered parts ① – ⑰ as a header row in column B/C/D+:
//
//   col A     col B (number)  col C (label)         col D, E, F, ...  (option labels)
//   キッチン  ①              キッチン天板          ﾁｬｲﾅ大理石(黒)    ﾁｬｲﾅ大理石(白)
//
// Trailing rows under a header may contain product codes in the same columns.
// Embedded swatch images are anchored per cell via xl/drawings/drawing<N>.xml.
//
// For color-mode parts (per public/assets/base/main/parts.json), the script
// extracts the swatch image and computes colorHex from the central 50%.
// For texture-mode parts, the swatch image is written to disk and the option
// points at it (designer replaces with a scene-resolution render later).
//
// Run with: npm run seed:parts

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import AdmZip from "adm-zip";
import * as XLSX from "xlsx";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const XLSX_PATH = resolve(ROOT, "resources/catalog/部材リスト.xlsx");
const PARTS_JSON = resolve(ROOT, "public/assets/base/main/parts.json");
const OUT_JSON = resolve(ROOT, "public/catalog/finish-options.json");
const OUT_WARN = resolve(ROOT, "public/catalog/finish-options.warnings.json");
const FINISHES_DIR = resolve(ROOT, "public/assets/finishes");
const SCENE_W = 3000;
const SCENE_H = 2142;

// Map sheet display name → URL-safe slug used in option ids.
const SHEET_SLUGS = {
  "アーバンシー": "urb",
  "レコリード": "rec",
};

// Strip workbook-author annotations from sheet names (e.g. "レコリード※床材のみ追加" → "レコリード").
function normalizeSheetName(raw) {
  const i = raw.indexOf("※");
  return (i >= 0 ? raw.slice(0, i) : raw).trim();
}

function sheetSlug(displayName) {
  return SHEET_SLUGS[displayName] ?? displayName.replace(/[^A-Za-z0-9]+/g, "-").toLowerCase();
}

// Circled numbers: ① (U+2460) → 1 … ⑳ (U+2473) → 20.
function circledToInt(s) {
  if (typeof s !== "string" || s.length === 0) return null;
  const cp = s.codePointAt(0);
  if (cp >= 0x2460 && cp <= 0x2473) return cp - 0x2460 + 1;
  return null;
}

function partIdFromCircled(s) {
  const n = circledToInt(s);
  return n === null ? null : String(n).padStart(2, "0");
}

// A11-style cell ref from 0-based (col, row).
function cellRef(col, row) {
  let s = "";
  let c = col;
  do {
    s = String.fromCharCode(65 + (c % 26)) + s;
    c = Math.floor(c / 26) - 1;
  } while (c >= 0);
  return `${s}${row + 1}`;
}

// Detect "no change" / "absent" labels (e.g. ② 光無し, ⑤ unchanged).
function isNoChangeLabel(label) {
  if (!label) return false;
  return /^(光無し|無し|無|なし|なし$|absent|none|unchanged)$/.test(label.trim());
}

// Detect product-code-only row cell content: alphanumeric/punctuation, no Japanese.
function looksLikeProductCode(s) {
  if (typeof s !== "string") return false;
  const t = s.trim();
  if (!t) return false;
  return /^[A-Za-z0-9][A-Za-z0-9\s\-./]*$/.test(t);
}

// Read xlsx as zip, extract per-cell embedded image map: { sheetName: Map<cellRef, Buffer> }.
function buildCellImageMap(buf, workbook) {
  const zip = new AdmZip(buf);
  const entries = new Map(zip.getEntries().map((e) => [e.entryName, e]));

  // Map sheet name → workbook sheet path (xl/worksheets/sheetN.xml) via workbook.xml.
  const wbXml = entries.get("xl/workbook.xml")?.getData().toString("utf-8") ?? "";
  const wbRels = entries.get("xl/_rels/workbook.xml.rels")?.getData().toString("utf-8") ?? "";

  // Parse <sheet name="..." sheetId=".." r:id="rIdN"/>
  const sheetRefs = [];
  for (const m of wbXml.matchAll(/<sheet\s+([^>]+?)\s*\/>/g)) {
    const attrs = parseAttrs(m[1]);
    sheetRefs.push({ name: attrs.name, rid: attrs["r:id"] });
  }
  // Parse workbook rels: rId → Target (e.g. "worksheets/sheet1.xml")
  const wbRelMap = new Map();
  for (const m of wbRels.matchAll(/<Relationship\s+([^>]+?)\s*\/>/g)) {
    const a = parseAttrs(m[1]);
    wbRelMap.set(a.Id, a.Target);
  }

  const result = {};
  for (const sref of sheetRefs) {
    const sheetTarget = wbRelMap.get(sref.rid);
    if (!sheetTarget) continue;
    const sheetPath = `xl/${sheetTarget}`;
    const sheetRelsPath = `xl/${sheetTarget.replace(/([^/]+)$/, "_rels/$1.rels")}`;
    const sheetRelsXml = entries.get(sheetRelsPath)?.getData().toString("utf-8") ?? "";
    // Find drawing rel
    let drawingTarget = null;
    for (const m of sheetRelsXml.matchAll(/<Relationship\s+([^>]+?)\s*\/>/g)) {
      const a = parseAttrs(m[1]);
      if (a.Type?.endsWith("/drawing")) {
        drawingTarget = a.Target; // e.g. "../drawings/drawing1.xml"
        break;
      }
    }
    if (!drawingTarget) {
      result[sref.name] = new Map();
      continue;
    }
    // Resolve drawing path
    const drawingPath = resolveRelPath(sheetPath, drawingTarget);
    const drawingXml = entries.get(drawingPath)?.getData().toString("utf-8") ?? "";
    const drawingRelsPath = drawingPath.replace(/([^/]+)$/, "_rels/$1.rels");
    const drawingRelsXml = entries.get(drawingRelsPath)?.getData().toString("utf-8") ?? "";
    const drawingRelMap = new Map();
    for (const m of drawingRelsXml.matchAll(/<Relationship\s+([^>]+?)\s*\/>/g)) {
      const a = parseAttrs(m[1]);
      drawingRelMap.set(a.Id, a.Target);
    }

    const cellMap = new Map();
    // Walk oneCellAnchor and twoCellAnchor blocks
    const anchorRe = /<xdr:(?:one|two)CellAnchor[\s\S]*?<\/xdr:(?:one|two)CellAnchor>/g;
    for (const block of drawingXml.matchAll(anchorRe)) {
      const text = block[0];
      const fromCol = readInt(text, /<xdr:from>[\s\S]*?<xdr:col>(\d+)<\/xdr:col>/);
      const fromRow = readInt(text, /<xdr:from>[\s\S]*?<xdr:row>(\d+)<\/xdr:row>/);
      const blip = text.match(/<a:blip\s+([^/>]+)\/?>/);
      if (fromCol === null || fromRow === null || !blip) continue;
      const blipAttrs = parseAttrs(blip[1]);
      const rid = blipAttrs["r:embed"];
      if (!rid) continue;
      const target = drawingRelMap.get(rid);
      if (!target) continue;
      const mediaPath = resolveRelPath(drawingPath, target);
      const mediaEntry = entries.get(mediaPath);
      if (!mediaEntry) continue;
      const ref = cellRef(fromCol, fromRow);
      cellMap.set(ref, mediaEntry.getData());
    }
    result[sref.name] = cellMap;
  }
  return result;
}

function parseAttrs(s) {
  const out = {};
  for (const m of s.matchAll(/(\w+(?::\w+)?)\s*=\s*"([^"]*)"/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

function readInt(text, re) {
  const m = text.match(re);
  return m ? parseInt(m[1], 10) : null;
}

function resolveRelPath(basePath, relTarget) {
  // basePath like "xl/worksheets/sheet1.xml", relTarget like "../drawings/drawing1.xml"
  const baseDir = basePath.split("/").slice(0, -1);
  const parts = relTarget.split("/");
  for (const p of parts) {
    if (p === "..") baseDir.pop();
    else if (p !== ".") baseDir.push(p);
  }
  return baseDir.join("/");
}

async function ensureDir(file) {
  await mkdir(dirname(file), { recursive: true });
}

// Compute average RGB of central 50% rect of an image buffer.
async function averageCentralColor(imgBuf) {
  const img = sharp(imgBuf);
  const meta = await img.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) return null;
  const cx = Math.floor(w / 4);
  const cy = Math.floor(h / 4);
  const cw = Math.max(1, Math.floor(w / 2));
  const ch = Math.max(1, Math.floor(h / 2));
  const { data, info } = await img
    .extract({ left: cx, top: cy, width: cw, height: ch })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  const channels = info.channels;
  for (let i = 0; i < data.length; i += channels) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    count++;
  }
  if (!count) return null;
  return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
}

function rgbToHex([r, g, b]) {
  const h = (n) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

// Parse a single sheet into an array of { partId, label, options:[{ index, label, productCode?, cellRef }] }.
function parsePartsFromSheet(sheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
    raw: false,
    blankrows: true,
  });
  const parts = [];
  let current = null;
  let trailingRowBudget = 0; // how many subsequent rows to scan for product codes / sub-labels
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const numCell = row?.[1] ?? null;
    const labelCell = row?.[2] ?? null;
    const partId = partIdFromCircled(typeof numCell === "string" ? numCell : "");
    if (partId && typeof labelCell === "string") {
      current = {
        partId,
        label: labelCell.replace(/\s+/g, " ").trim(),
        options: [],
        headerRow: r,
      };
      // Capture option labels from columns D onward (index 3+).
      // Embedded swatch images are anchored one row BELOW the header (the visual row),
      // so look up images at (col, headerRow + 1).
      for (let c = 3; c < (row?.length ?? 0); c++) {
        const v = row[c];
        if (typeof v === "string" && v.trim()) {
          current.options.push({
            index: c - 3,
            label: v.replace(/\s+/g, " ").trim(),
            productCode: undefined,
            cellRef: cellRef(c, r + 1),
          });
        }
      }
      parts.push(current);
      trailingRowBudget = 4; // scan up to 4 trailing rows
      continue;
    }
    if (current && trailingRowBudget > 0) {
      // Scan D+ for product codes mapping to existing options by column index.
      let anyMatched = false;
      for (let c = 3; c < (row?.length ?? 0); c++) {
        const v = row[c];
        if (typeof v !== "string" || !v.trim()) continue;
        anyMatched = true;
        const opt = current.options.find((o) => o.index === c - 3);
        if (opt) {
          if (looksLikeProductCode(v) && !opt.productCode) {
            opt.productCode = v.trim();
          }
          // sub-labels (Japanese) are ignored to keep MVP shape simple
        }
      }
      trailingRowBudget--;
      if (!anyMatched) trailingRowBudget = Math.min(trailingRowBudget, 1);
      continue;
    }
  }
  return parts;
}

// Slugify an option label for inclusion in option ids; falls back to index if empty.
function slugifyLabel(label, fallbackIndex) {
  const ascii = label
    .replace(/[（(].*?[)）]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return ascii || `opt${fallbackIndex}`;
}

async function main() {
  const buf = await readFile(XLSX_PATH);
  // LFS pointer guard
  if (buf.slice(0, 60).toString("utf-8").startsWith("version https://git-lfs.github.com/spec/v1")) {
    throw new Error(
      `${XLSX_PATH} is an unresolved Git LFS pointer file.\n` +
        `Run \`git lfs install && git lfs pull\` and retry.`,
    );
  }

  const wb = XLSX.read(buf, { type: "buffer" });
  const cellImagesBySheet = buildCellImageMap(buf, wb);

  // Load parts.json for renderMode lookup.
  const partsManifest = JSON.parse(await readFile(PARTS_JSON, "utf-8"));
  const partRenderMode = new Map(
    partsManifest.parts.map((p) => [p.id, p.renderMode]),
  );
  const knownPartIds = new Set(partsManifest.parts.map((p) => p.id));

  // Wipe finishes dir for a clean idempotent run.
  await rm(FINISHES_DIR, { recursive: true, force: true });

  const outOptions = [];
  const warnings = [];
  const seenIds = new Set();

  // Build a transparent texture once for "no change" texture-mode options.
  const transparentBuf = Buffer.alloc(SCENE_W * SCENE_H * 4); // all zeros = transparent

  for (const rawSheetName of wb.SheetNames) {
    const displayName = normalizeSheetName(rawSheetName);
    const sheet = wb.Sheets[rawSheetName];
    const cellImages = cellImagesBySheet[rawSheetName] ?? new Map();
    const sheetParts = parsePartsFromSheet(sheet);

    for (const part of sheetParts) {
      if (!knownPartIds.has(part.partId)) {
        warnings.push({
          kind: "unknown-part",
          sheet: displayName,
          partId: part.partId,
          label: part.label,
          message: `workbook part ${part.partId} ("${part.label}") is not declared in parts.json`,
        });
        continue;
      }
      const renderMode = partRenderMode.get(part.partId);
      for (const opt of part.options) {
        const slug = slugifyLabel(opt.label, opt.index);
        const optionId = `${part.partId}-${sheetSlug(displayName)}-${opt.index}-${slug}`;
        if (seenIds.has(optionId)) {
          warnings.push({
            kind: "duplicate-id",
            optionId,
            partId: part.partId,
            label: opt.label,
          });
          continue;
        }
        seenIds.add(optionId);

        const imgBuf = cellImages.get(opt.cellRef);
        const isNone = isNoChangeLabel(opt.label);

        let thumbnailUrl;
        let colorHex;
        let textureUrl;

        // Always try to write a thumbnail for the panel chip; even color-mode parts use it.
        const thumbPath = resolve(FINISHES_DIR, part.partId, `${optionId}.png`);
        await ensureDir(thumbPath);

        if (imgBuf) {
          await writeFile(thumbPath, imgBuf);
          thumbnailUrl = `/assets/finishes/${part.partId}/${optionId}.png`;
        } else {
          // No swatch in workbook; emit a 1x1 transparent so the URL resolves.
          await sharp({
            create: {
              width: 32,
              height: 32,
              channels: 4,
              background: { r: 220, g: 220, b: 220, alpha: 1 },
            },
          })
            .png()
            .toFile(thumbPath);
          thumbnailUrl = `/assets/finishes/${part.partId}/${optionId}.png`;
          warnings.push({
            kind: "missing-swatch",
            sheet: displayName,
            partId: part.partId,
            optionId,
            label: opt.label,
            cellRef: opt.cellRef,
            message: `no embedded swatch image for ${displayName} part ${part.partId} option ${opt.label}`,
          });
        }

        if (renderMode === "color") {
          if (isNone) {
            warnings.push({
              kind: "color-mode-no-change",
              partId: part.partId,
              optionId,
              label: opt.label,
              message:
                'color-mode "no change" option emitted with neutral white; consider clearing selection instead',
            });
            colorHex = "#FFFFFF";
          } else if (imgBuf) {
            const rgb = await averageCentralColor(imgBuf);
            if (rgb) {
              colorHex = rgbToHex(rgb);
            } else {
              colorHex = "#CCCCCC";
              warnings.push({
                kind: "color-extract-failed",
                partId: part.partId,
                optionId,
                label: opt.label,
              });
            }
          } else {
            colorHex = "#CCCCCC";
          }
        } else {
          // texture mode
          if (isNone) {
            // Write a scene-size transparent PNG specifically for this option.
            const noneTexPath = resolve(
              FINISHES_DIR,
              part.partId,
              `${optionId}.texture.png`,
            );
            await sharp(transparentBuf, {
              raw: { width: SCENE_W, height: SCENE_H, channels: 4 },
            })
              .png({ compressionLevel: 9 })
              .toFile(noneTexPath);
            textureUrl = `/assets/finishes/${part.partId}/${optionId}.texture.png`;
          } else {
            // For real texture-mode options, the swatch is a placeholder until a designer
            // authors a scene-resolution finish render. Point textureUrl at the swatch.
            textureUrl = thumbnailUrl;
          }
        }

        outOptions.push({
          id: optionId,
          partId: part.partId,
          sheet: displayName,
          label: opt.label,
          ...(opt.productCode ? { productCode: opt.productCode } : {}),
          thumbnailUrl,
          ...(colorHex ? { colorHex } : {}),
          ...(textureUrl ? { textureUrl } : {}),
        });
      }
    }
  }

  await ensureDir(OUT_JSON);
  await writeFile(
    OUT_JSON,
    JSON.stringify({ version: 1, options: outOptions }, null, 2),
  );
  await writeFile(OUT_WARN, JSON.stringify(warnings, null, 2));

  console.log(`✓ wrote ${outOptions.length} options to ${OUT_JSON}`);
  console.log(`✓ wrote ${warnings.length} warnings to ${OUT_WARN}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
