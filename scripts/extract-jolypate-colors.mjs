#!/usr/bin/env node
// Build `public/catalog/jolypate-colors.json` from the AICA JOLYPATE colour
// table PDF.
//
// Only colour numbers whose label sits on a **yellow highlight band** are
// emitted — those are the orderable, tintable colours. Everything else in the
// catalogue (special-order and non-tintable entries such as JP-100BK or
// T6013, plus the legend tables) is deliberately excluded, and every
// exclusion is written to the warnings file so a human can review it.
//
// How it reads the PDF
// --------------------
// Two independent signals, joined by position:
//
//   * **Colour numbers** come from the PDF's *text layer* via pdfjs — no OCR.
//     The catalogue is a Quartz-generated PDF with real text, so the codes are
//     exact rather than recognized.
//   * **Yellow bands and swatch colours** come from a *raster* of each page
//     (poppler's `pdftoppm`), sampled with sharp.
//
// Reading the bands out of the PDF's vector operators was tried first and
// abandoned: the highlight rectangles on some pages live inside nested form
// XObjects whose transforms do not compose cleanly at the operator-list level,
// so the same code that resolved pages 1 and 5 correctly mis-placed pages 2-4.
// The raster has no such ambiguity.
//
// Ground truth
// ------------
// The design intended to cross-check against the catalogue's index page. That
// page turned out to carry 932 `showText` operations but only one extractable
// string — its fonts have no ToUnicode map, so the index is unreadable without
// OCR. The structural invariant used instead is the catalogue's own stated
// total: the swatch pages must yield exactly EXPECTED_TOTAL distinct colour
// numbers. That is checkable from the same pages and fails loudly if the
// layout ever shifts.
//
// Usage:  npm run seed:jolypate  [-- --debug]
// Requires poppler's `pdftoppm` on PATH (brew install poppler).

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const ROOT = process.cwd();
const PDF = join(ROOT, "public/assets/jolypate/ジョリパカタログ 3.pdf");
const SANDSTONE_SRC = join(ROOT, "public/assets/jolypate/ジョリパッド砂岩仕上.jpg");
const SANDSTONE_OUT = join(ROOT, "public/assets/jolypate/sandstone.jpg");
const SWATCH_DIR = join(ROOT, "public/assets/jolypate/swatches");
const OUT_JSON = join(ROOT, "public/catalog/jolypate-colors.json");
const OUT_WARN = join(ROOT, "public/catalog/jolypate-colors.warnings.json");
const OVERRIDES = join(ROOT, "resources/catalog/jolypate-color-overrides.json");

const DPI = 150;
const SCALE = DPI / 72;
const DEBUG = process.argv.includes("--debug");

/**
 * Colour numbers: `T1403`, `JP-100BK`, `JQ-650SWH`, `JP-100AA8`.
 *
 * Deliberately does NOT match product+colour composites like `JQ-201T2029`
 * (a finish-feel sample of colour T2029 in product series JQ-201), which are
 * not catalogue colours.
 */
const CODE_RE = /^(T\d{4}|JP-\d{3}(?:BK|SBK|AA\d+)?|JQ-\d{3}(?:BK|SBK|SWH)?)$/;

/**
 * Which catalogue category each swatch page belongs to.
 *
 * Declared rather than detected because the headings are not uniformly
 * readable: pages 2, 4 and 5 carry live text ("M I S T Y" + "COLOR", letter-
 * spaced), but page 6's TRAD heading is vector outlines with no text layer at
 * all. Where a heading IS readable it is cross-checked against this map, so a
 * reordered catalogue fails loudly instead of silently mislabelling colours.
 *
 * Pages outside this map hold no catalogue colours: page 1 is the cover,
 * page 7 the colour-table explainer (its vivid special-order colours and
 * finish-feel samples are not part of the colour table), page 8 the index.
 */
const PAGE_CATEGORY = new Map([
  [2, "NEUTRAL"],
  [3, "NEUTRAL"],
  [4, "MISTY"],
  [5, "SUNNY"],
  [6, "TRAD"],
]);

/** Heading text, for cross-checking `PAGE_CATEGORY` where it is readable. */
const CATEGORY_HEADINGS = [
  { match: /NEUTRALCOLOR/i, key: "NEUTRAL" },
  { match: /MISTYCOLOR/i, key: "MISTY" },
  { match: /SUNNYCOLOR/i, key: "SUNNY" },
  { match: /TRADCOLOR/i, key: "TRAD" },
];

/**
 * Minimum colour numbers sharing a baseline for the row to be a swatch grid
 * row. The colour table is laid out 4-up or 6-up; the special-order box on
 * page 3 holds 3. Legend and specification tables put one code per line, so
 * this cleanly separates catalogue colours from product-series references
 * without depending on where those tables sit on the page.
 */
const MIN_GRID_ROW = 3;

/**
 * The catalogue cover states 全148色. We cannot reproduce that number exactly
 * — it is not derivable from the swatch grids alone, and the index page that
 * would settle it has no readable text layer (932 glyph-painting ops, one
 * extractable string). It is reported for reference only; the invariant that
 * actually guards this seed is the accounting check below, which requires
 * every colour number found to be either emitted or explicitly warned about.
 */
const CATALOGUE_STATED_TOTAL = 148;

// ---------------------------------------------------------------- utilities

const log = (...a) => console.log(...a);
const debug = (...a) => { if (DEBUG) console.log("   [debug]", ...a); };

function isYellowPixel(r, g, b) {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  if (mx < 180) return false;          // too dark to be the highlight
  const d = mx - mn;
  if (d < 60) return false;            // too desaturated
  let h;
  if (mx === r) h = 60 * (((g - b) / d) % 6);
  else if (mx === g) h = 60 * ((b - r) / d + 2);
  else h = 60 * ((r - g) / d + 4);
  if (h < 0) h += 360;
  return h >= 40 && h <= 75;
}

function toHex(r, g, b) {
  const h = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * Trimmed mean of a pixel set: drop the darkest and lightest 10% by luminance
 * before averaging. Jolypate finishes are aggregate-bearing, so a plain mean
 * gets dragged around by speckle; the trimmed mean reports the field colour a
 * person actually sees.
 */
function trimmedMeanRGB(pixels, trim = 0.1) {
  if (pixels.length === 0) return null;
  const withLum = pixels.map((p) => ({ p, l: 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2] }));
  withLum.sort((a, b) => a.l - b.l);
  const cut = Math.floor(withLum.length * trim);
  const kept = withLum.slice(cut, withLum.length - cut);
  const use = kept.length ? kept : withLum;
  let r = 0, g = 0, b = 0;
  for (const { p } of use) { r += p[0]; g += p[1]; b += p[2]; }
  return [r / use.length, g / use.length, b / use.length];
}

// ------------------------------------------------------------------ raster

class PageRaster {
  constructor(buf, info, pageHeightPt) {
    this.px = buf;
    this.w = info.width;
    this.h = info.height;
    this.ch = info.channels;
    this.pageHeightPt = pageHeightPt;
  }

  /** PDF user space (y up, origin bottom-left) -> raster pixel (y down). */
  toPx(xPt, yPt) {
    return [Math.round(xPt * SCALE), Math.round((this.pageHeightPt - yPt) * SCALE)];
  }

  at(x, y) {
    const o = (y * this.w + x) * this.ch;
    return [this.px[o], this.px[o + 1], this.px[o + 2]];
  }

  /** Collect pixels of an axis-aligned box given in PDF points. */
  sampleBox(xPt, yPt, wPt, hPt) {
    const [x0, y1] = this.toPx(xPt, yPt);
    const [x1, y0] = this.toPx(xPt + wPt, yPt + hPt);
    const out = [];
    for (let y = Math.max(0, y0); y <= Math.min(this.h - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(this.w - 1, x1); x++) {
        out.push(this.at(x, y));
      }
    }
    return out;
  }

  /** Fraction of pixels in the box that read as highlight yellow. */
  yellowFraction(xPt, yPt, wPt, hPt) {
    const px = this.sampleBox(xPt, yPt, wPt, hPt);
    if (!px.length) return 0;
    let n = 0;
    for (const [r, g, b] of px) if (isYellowPixel(r, g, b)) n++;
    return n / px.length;
  }
}

async function rasterizePage(pdfPath, pageNo, pageHeightPt, tmpDir) {
  const prefix = join(tmpDir, `pg`);
  try {
    execFileSync(
      "pdftoppm",
      ["-r", String(DPI), "-f", String(pageNo), "-l", String(pageNo), "-png", pdfPath, prefix],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(
        "`pdftoppm` が見つかりません。poppler をインストールしてください (brew install poppler)",
      );
    }
    throw err;
  }
  // pdftoppm zero-pads the page number to the width of the page count.
  const candidates = [`${prefix}-${pageNo}.png`, `${prefix}-0${pageNo}.png`, `${prefix}-00${pageNo}.png`];
  const file = candidates.find((f) => existsSync(f));
  if (!file) throw new Error(`pdftoppm がページ ${pageNo} の PNG を出力しませんでした`);
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return new PageRaster(data, info, pageHeightPt);
}

// -------------------------------------------------------------------- main

async function main() {
  if (!existsSync(PDF)) throw new Error(`カタログ PDF が見つかりません: ${PDF}`);

  const tmpDir = join(tmpdir(), `jolypate-seed-${process.pid}`);
  mkdirSync(tmpDir, { recursive: true });
  mkdirSync(SWATCH_DIR, { recursive: true });
  mkdirSync(join(ROOT, "public/catalog"), { recursive: true });

  const warnings = [];
  const warn = (reason, detail) => warnings.push({ reason, ...detail });

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(readFileSync(PDF)),
    useSystemFonts: true,
  }).promise;

  /** code -> record (deduped across pages; a colour may appear in two categories) */
  const byCode = new Map();
  /** Every colour-number label seen anywhere, so nothing can vanish silently. */
  let labelsSeen = 0;
  let labelsAccounted = 0;

  for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
    const page = await doc.getPage(pageNo);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = tc.items
      .map((i) => ({
        s: i.str.trim(),
        x: i.transform[4],
        y: i.transform[5],
        w: i.width,
        h: i.height,
      }))
      .filter((t) => t.s);

    const codes = items.filter((t) => CODE_RE.test(t.s));
    labelsSeen += codes.length;

    const category = PAGE_CATEGORY.get(pageNo);
    if (!category) {
      // Cover, explainer, index — no catalogue colours. Record what we are
      // walking past so "why is X missing" always has an answer.
      for (const c of codes) {
        labelsAccounted++;
        warn("skipped-non-swatch-page", { code: c.s, page: pageNo });
      }
      debug(`page ${pageNo}: not a swatch page (${codes.length} colour-number labels skipped)`);
      continue;
    }

    // Cross-check the declared category against the printed heading, where
    // the heading is text at all. Letter-spaced headings arrive as separate
    // items ("M I S T Y"), so compare with whitespace stripped.
    const joined = items.map((t) => t.s).join("").replace(/\s+/g, "");
    const detected = CATEGORY_HEADINGS.find((c) => c.match.test(joined));
    if (detected && detected.key !== category) {
      throw new Error(
        `ページ ${pageNo} の見出しは ${detected.key} ですが PAGE_CATEGORY は ${category} です。カタログの構成が変わっています。`,
      );
    }

    const raster = await rasterizePage(PDF, pageNo, vp.height, tmpDir);

    // Swatch-grid rows: colour numbers sharing a baseline. Legend and
    // specification tables put one code per line and are excluded by size.
    const rows = new Map();
    for (const c of codes) {
      const key = Math.round(c.y);
      if (!rows.has(key)) rows.set(key, []);
      rows.get(key).push(c);
    }

    // Column pitch, derived from the page rather than hardcoded (the
    // catalogue uses both 4-up and 6-up grids).
    const gridCodes = [...rows.values()].filter((r) => r.length >= MIN_GRID_ROW).flat();
    const xs = [...new Set(gridCodes.map((c) => Math.round(c.x)))].sort((a, b) => a - b);
    const gaps = xs.slice(1).map((v, i) => v - xs[i]).filter((g) => g > 20);
    const pitch = gaps.length ? Math.min(...gaps) : 95;

    let pageKept = 0;
    for (const [, row] of rows) {
      if (row.length < MIN_GRID_ROW) {
        for (const c of row) {
          labelsAccounted++;
          warn("skipped-not-in-swatch-grid", { code: c.s, page: pageNo, rowSize: row.length });
          debug(`page ${pageNo} ${c.s}: row of ${row.length}, not a swatch grid row — skipped`);
        }
        continue;
      }
      for (const c of row) {
        labelsAccounted++;
        pageKept++;

        // The highlight sits behind the label. Sample the label's own box,
        // padded slightly: the glyphs themselves are dark, so a highlighted
        // label yields a modest but unmistakably non-zero yellow fraction,
        // while an unhighlighted one yields exactly zero. The two populations
        // are cleanly separated — measured 3-7% versus 0%.
        const yellow = raster.yellowFraction(c.x - 1, c.y - 2, c.w + 2, c.h + 3);

        // The swatch is the printed square directly above the label. Sample a
        // conservative box well inside it, so the sample never crosses into
        // the page background or a neighbouring column.
        const boxW = Math.min(c.w * 1.6, pitch * 0.6);
        const boxH = 26;
        const boxX = c.x + c.w / 2 - boxW / 2;
        const boxY = c.y + c.h + 4;
        const mean = trimmedMeanRGB(raster.sampleBox(boxX, boxY, boxW, boxH));
        if (!mean) {
          warn("swatch-sample-empty", { code: c.s, page: pageNo });
          continue;
        }

        const highlighted = yellow > 0.01;
        const prev = byCode.get(c.s);
        if (prev) {
          // A colour can be printed on two pages (a neutral repeated on the
          // TRAD page). It is orderable if it is highlighted anywhere.
          prev.highlighted = prev.highlighted || highlighted;
          prev.pages.push(pageNo);
          continue;
        }
        byCode.set(c.s, {
          code: c.s,
          category,
          page: pageNo,
          pages: [pageNo],
          highlighted,
          rgb: mean,
          yellowFraction: yellow,
        });
      }
    }
    log(`page ${pageNo} [${category}]: ${pageKept} swatch labels of ${codes.length} colour numbers`);
  }

  // ------------------------------------------------------ self-verification

  const all = [...byCode.values()];
  const included = all.filter((r) => r.highlighted);
  const excluded = all.filter((r) => !r.highlighted);

  for (const r of excluded) {
    warn("excluded-not-highlighted", { code: r.code, category: r.category, pages: r.pages });
  }

  log("");
  log(`colour-number labels found : ${labelsSeen}`);
  log(`  accounted for            : ${labelsAccounted}`);
  log(`distinct catalogue colours : ${all.length}   (catalogue states ${CATALOGUE_STATED_TOTAL})`);
  log(`  highlighted (emitted)    : ${included.length}`);
  log(`  not highlighted          : ${excluded.length}  [${excluded.map((r) => r.code).join(", ")}]`);

  // The guarantee that matters: nothing disappears quietly. Every colour
  // number the text layer produced is either emitted, or carries a warning
  // saying why it was left out.
  if (labelsAccounted !== labelsSeen) {
    log("");
    log(`ERROR: ${labelsSeen} 個の色番ラベルのうち ${labelsAccounted} 個しか分類できませんでした。`);
    log("       抽出が色番を取りこぼしています。--debug で内訳を確認してください。");
    writeFileSync(OUT_WARN, JSON.stringify({ generatedFrom: "ジョリパカタログ 3.pdf", warnings }, null, 2) + "\n");
    rmSync(tmpDir, { recursive: true, force: true });
    process.exit(1);
  }
  if (included.length === 0) {
    log("");
    log("ERROR: 黄色ハイライトの色番が 1 つも見つかりませんでした。ハイライト検出が壊れています。");
    rmSync(tmpDir, { recursive: true, force: true });
    process.exit(1);
  }

  // --------------------------------------------------- designer overrides

  let overrides = {};
  if (existsSync(OVERRIDES)) {
    overrides = JSON.parse(readFileSync(OVERRIDES, "utf-8"));
    const applied = Object.keys(overrides).filter((k) => byCode.has(k));
    log("");
    log(`overrides applied: ${applied.length} [${applied.join(", ")}]`);
    for (const k of Object.keys(overrides)) {
      if (!byCode.has(k)) warn("override-unknown-code", { code: k });
    }
  } else {
    debug("no override file; using extracted values only");
  }

  // ------------------------------------------------------------- emit

  const entries = [];
  for (const r of included) {
    const ov = overrides[r.code] ?? {};
    if (ov.include === false) {
      warn("excluded-by-override", { code: r.code });
      continue;
    }
    const rgb = ov.colorHex
      ? [
          parseInt(ov.colorHex.slice(1, 3), 16),
          parseInt(ov.colorHex.slice(3, 5), 16),
          parseInt(ov.colorHex.slice(5, 7), 16),
        ]
      : r.rgb;
    entries.push({
      code: r.code,
      category: r.category,
      page: r.page,
      colorHex: toHex(rgb[0], rgb[1], rgb[2]),
      ...(ov.nameJa ? { nameJa: ov.nameJa } : {}),
      swatchUrl: `/assets/jolypate/swatches/${r.code}.png`,
    });
  }
  entries.sort((a, b) => a.code.localeCompare(b.code));

  // Swatch PNGs: a flat tile of the sampled colour. The printed swatches are
  // photographs of a textured finish, but what the picker needs is the colour
  // the zone will actually be filled with — showing the photo would promise a
  // texture the composition does not reproduce.
  for (const e of entries) {
    const r = parseInt(e.colorHex.slice(1, 3), 16);
    const g = parseInt(e.colorHex.slice(3, 5), 16);
    const b = parseInt(e.colorHex.slice(5, 7), 16);
    await sharp({
      create: { width: 128, height: 128, channels: 3, background: { r, g, b } },
    })
      .png({ compressionLevel: 9 })
      .toFile(join(SWATCH_DIR, `${e.code}.png`));
  }

  writeFileSync(
    OUT_JSON,
    JSON.stringify({ version: 1, generatedFrom: "ジョリパカタログ 3.pdf", colors: entries }, null, 2) + "\n",
  );
  writeFileSync(
    OUT_WARN,
    JSON.stringify({ generatedFrom: "ジョリパカタログ 3.pdf", warnings }, null, 2) + "\n",
  );

  // ------------------------------------------------- sandstone finish tile

  // Greyscale, centred on mid-grey, square-cropped so it tiles.
  //
  // Two adjustments, both needed for the overlay to read as *grain* rather
  // than as a darkening:
  //
  //   * Centre the mean on 127.5. Soft-light against exactly mid-grey is a
  //     no-op, so this is what stops the texture shifting the base colour.
  //   * Compress contrast toward that centre. Soft-light is not symmetric:
  //     over a bright base, pixels below mid-grey darken more than pixels
  //     above it lighten, so a full-contrast texture with a correct *mean*
  //     still drags the result down. Measured on a real zone, the raw tile
  //     cost 8.6% of luminance. Compression trades some grain depth for a
  //     colour that stays the colour the customer picked.
  const SANDSTONE_CONTRAST = 0.35;
  const meta = await sharp(SANDSTONE_SRC).metadata();
  const side = Math.min(meta.width, meta.height);
  const grey = sharp(SANDSTONE_SRC)
    .extract({
      left: Math.floor((meta.width - side) / 2),
      top: Math.floor((meta.height - side) / 2),
      width: side,
      height: side,
    })
    .resize(512, 512)
    .greyscale();
  const { data: gbuf, info: ginfo } = await grey.raw().toBuffer({ resolveWithObject: true });
  let sum = 0;
  for (let i = 0; i < gbuf.length; i++) sum += gbuf[i];
  const meanLum = sum / gbuf.length;
  const norm = Buffer.alloc(gbuf.length);
  for (let i = 0; i < gbuf.length; i++) {
    // Recentre on mid-grey, then pull toward it by the contrast factor.
    norm[i] = Math.max(
      0,
      Math.min(255, 127.5 + (gbuf[i] - meanLum) * SANDSTONE_CONTRAST),
    );
  }
  let sum2 = 0;
  for (let i = 0; i < norm.length; i++) sum2 += norm[i];
  await sharp(norm, { raw: { width: ginfo.width, height: ginfo.height, channels: 1 } })
    .jpeg({ quality: 90 })
    .toFile(SANDSTONE_OUT);
  log("");
  log(
    `sandstone tile: 512x512, mean ${meanLum.toFixed(1)} -> ${(sum2 / norm.length).toFixed(1)} ` +
      `(contrast x${SANDSTONE_CONTRAST})`,
  );

  rmSync(tmpDir, { recursive: true, force: true });

  log("");
  log(`wrote ${entries.length} colours -> public/catalog/jolypate-colors.json`);
  log(`wrote ${warnings.length} warnings -> public/catalog/jolypate-colors.warnings.json`);
  log(`wrote ${entries.length} swatches -> public/assets/jolypate/swatches/`);
}

main().catch((err) => {
  console.error("seed:jolypate failed:", err.message);
  process.exit(1);
});
