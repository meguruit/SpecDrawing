// For every (partId, optionLabel) → variant entry in
// resources/catalog/finish-base-overrides.json, load the variant base
// (resources/base/ベースパース_<variant>.jpg), crop the part region using
// the part's mask, and write a bbox-cropped PNG to a SHARED path
// public/assets/finishes/<partId>/_v_<variant>.png — one file per
// (partId, variant), referenced by every matching option across sheets.
// Each option's textureUrl is rewritten to that shared path, and a
// textureBox { x, y, width, height } is attached so the runtime paints
// the cropped piece at the right scene coords.
//
// Updates public/catalog/finish-options.json. Appends warnings for
// missing variant bases or unmatched option labels.
//
// Idempotent: re-running with unchanged inputs produces the same outputs.
//
// Run with: npm run seed:variants

import sharp from "sharp";
import { readFile, writeFile, stat, mkdir, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCENE_DIR = resolve(ROOT, "public/assets/base/main");
const SCENE_JSON = resolve(SCENE_DIR, "scene.json");
const PARTS_JSON = resolve(SCENE_DIR, "parts.json");
const FINISHES_DIR = resolve(ROOT, "public/assets/finishes");
const OPTIONS_JSON = resolve(ROOT, "public/catalog/finish-options.json");
const SHEETS_JSON = resolve(ROOT, "public/catalog/sheets.json");
const WARNINGS_JSON = resolve(ROOT, "public/catalog/finish-options.warnings.json");
const OVERRIDES = resolve(ROOT, "resources/catalog/finish-base-overrides.json");
const VARIANT_MAPPING = resolve(ROOT, "resources/catalog/finish-variant-mapping.json");
const RESOURCES_BASE = resolve(ROOT, "resources/base");
const PRIMARY_SHEET = "アーバンシー";

// Pad the polygon bbox to make sure mask Gaussian-feathered edges
// (from seed:masks) aren't clipped out of the cropped piece.
const BBOX_PAD = 8;

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(path) {
  await mkdir(dirname(path), { recursive: true });
}

async function loadVariantBase(variantKey, sceneW, sceneH) {
  const path = resolve(RESOURCES_BASE, `ベースパース_${variantKey}.jpg`);
  if (!(await exists(path))) return null;
  const { data, info } = await sharp(path)
    .resize(sceneW, sceneH, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, sourcePath: path };
}

async function loadMaskAlpha(partMask, sceneW, sceneH) {
  const path = resolve(SCENE_DIR, partMask);
  const { data, info } = await sharp(path)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== sceneW || info.height !== sceneH) {
    throw new Error(
      `mask ${partMask} dimensions (${info.width}×${info.height}) do not match scene (${sceneW}×${sceneH})`,
    );
  }
  return { data, channels: info.channels };
}

// Accept legacy `polygon: Vertex[]` or new `polygons: [{outer, holes?}]`
// and return the union of all outer rings as a flat vertex list. Holes do
// not affect the bbox — the cropped texture covers the entire region the
// mask might tint.
function partOuterVertices(part) {
  if (Array.isArray(part.polygons)) {
    return part.polygons.flatMap((p) => p.outer);
  }
  if (Array.isArray(part.polygon)) return part.polygon;
  throw new Error(`part ${part.id} has neither polygons nor polygon`);
}

function polygonBbox(vertices, sceneW, sceneH) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of vertices) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const x = Math.max(0, Math.floor(minX) - BBOX_PAD);
  const y = Math.max(0, Math.floor(minY) - BBOX_PAD);
  const right = Math.min(sceneW, Math.ceil(maxX) + BBOX_PAD);
  const bottom = Math.min(sceneH, Math.ceil(maxY) + BBOX_PAD);
  return { x, y, width: right - x, height: bottom - y };
}

async function writeCroppedPng(outPath, opts) {
  const { variantRgb, maskAlpha, maskChannels, sceneW, box } = opts;
  const out = Buffer.alloc(box.width * box.height * 4);
  for (let dy = 0; dy < box.height; dy++) {
    const sy = box.y + dy;
    for (let dx = 0; dx < box.width; dx++) {
      const sx = box.x + dx;
      const srcI = sy * sceneW + sx;
      const dstI = (dy * box.width + dx) * 4;
      out[dstI] = variantRgb[srcI * 3];
      out[dstI + 1] = variantRgb[srcI * 3 + 1];
      out[dstI + 2] = variantRgb[srcI * 3 + 2];
      out[dstI + 3] = maskAlpha[srcI * maskChannels + (maskChannels - 1)];
    }
  }
  await ensureDir(outPath);
  await sharp(out, { raw: { width: box.width, height: box.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
}

// Compute the dominant non-white sRGB color of an icon PNG: drop pixels
// where every channel is > 240 (background/edge), then channel-wise mean
// the rest. Returns { r, g, b, confidence } where `confidence` is the
// fraction of non-white pixels (used to flag low-signal swatches).
async function dominantNonWhiteColor(iconPath) {
  const { data, info } = await sharp(iconPath)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let kept = 0;
  const total = info.width * info.height;
  for (let i = 0; i < total; i++) {
    const r = data[i * 3];
    const g = data[i * 3 + 1];
    const b = data[i * 3 + 2];
    if (r > 240 && g > 240 && b > 240) continue;
    sumR += r;
    sumG += g;
    sumB += b;
    kept++;
  }
  if (kept === 0) return { r: 128, g: 128, b: 128, confidence: 0 };
  return {
    r: Math.round(sumR / kept),
    g: Math.round(sumG / kept),
    b: Math.round(sumB / kept),
    confidence: kept / total,
  };
}

// Write a PNG that is the masked variant base converted to monotone
// luminance, then multiplied by an sRGB tint color. Output is bbox-sized
// with the part's alpha preserved. Used for tint-base alternative
// rendering: every alternative on a tint-base part gets a grain-following
// texture whose dominant color matches its swatch icon.
//
// `lift` (0..1) pulls the luminance map toward white BEFORE the multiply
// so dark grain bands don't crush light icon colors (white/ivory) toward
// black. Y' = Y + (1 - Y) * lift; lift=0 is pure multiply (full contrast),
// lift=1 is flat fill.
async function writeTintedPng(outPath, opts) {
  const { variantRgb, maskAlpha, maskChannels, sceneW, box, tint, lift = 0 } = opts;
  const out = Buffer.alloc(box.width * box.height * 4);
  for (let dy = 0; dy < box.height; dy++) {
    const sy = box.y + dy;
    for (let dx = 0; dx < box.width; dx++) {
      const sx = box.x + dx;
      const srcI = sy * sceneW + sx;
      const dstI = (dy * box.width + dx) * 4;
      const r = variantRgb[srcI * 3];
      const g = variantRgb[srcI * 3 + 1];
      const b = variantRgb[srcI * 3 + 2];
      // Linear sRGB luminance (Rec. 709 weights). Acceptable visual match
      // for our wood-grain regions; perceptual L* would be marginal here.
      const y = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const yLifted = y + (1 - y) * lift;
      out[dstI] = Math.min(255, Math.round(tint.r * yLifted));
      out[dstI + 1] = Math.min(255, Math.round(tint.g * yLifted));
      out[dstI + 2] = Math.min(255, Math.round(tint.b * yLifted));
      out[dstI + 3] = maskAlpha[srcI * maskChannels + (maskChannels - 1)];
    }
  }
  await ensureDir(outPath);
  await sharp(out, { raw: { width: box.width, height: box.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
}

// Compute the mean RGB of `variantRgb` over a "neighborhood ring": pixels
// inside the part's bbox where the dilated mask is opaque AND the original
// mask is transparent. The dilation is a simple chebyshev (square)
// dilation by `dilatePx` pixels — sufficient resolution for sampling the
// surrounding background. Returns { r, g, b }.
function neighborhoodRingMean(variantRgb, maskAlpha, maskChannels, sceneW, box, dilatePx) {
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let kept = 0;
  for (let dy = 0; dy < box.height; dy++) {
    const sy = box.y + dy;
    for (let dx = 0; dx < box.width; dx++) {
      const sx = box.x + dx;
      const srcI = sy * sceneW + sx;
      const a = maskAlpha[srcI * maskChannels + (maskChannels - 1)];
      if (a > 8) continue; // inside mask — skip
      // Check if any pixel within `dilatePx` Chebyshev distance is opaque
      // (would be inside the dilated mask).
      let isInRing = false;
      const x0 = Math.max(0, sx - dilatePx);
      const x1 = Math.min(sceneW - 1, sx + dilatePx);
      const y0 = Math.max(0, sy - dilatePx);
      const y1 = Math.min(box.y + box.height - 1, sy + dilatePx);
      for (let qy = y0; qy <= y1 && !isInRing; qy++) {
        for (let qx = x0; qx <= x1 && !isInRing; qx++) {
          const qI = qy * sceneW + qx;
          if (maskAlpha[qI * maskChannels + (maskChannels - 1)] > 128) isInRing = true;
        }
      }
      if (!isInRing) continue;
      sumR += variantRgb[srcI * 3];
      sumG += variantRgb[srcI * 3 + 1];
      sumB += variantRgb[srcI * 3 + 2];
      kept++;
    }
  }
  if (kept === 0) return { r: 128, g: 128, b: 128 };
  return {
    r: Math.round(sumR / kept),
    g: Math.round(sumG / kept),
    b: Math.round(sumB / kept),
  };
}

// Write a PNG that is a solid tint color filled inside the part's mask
// (alpha = mask alpha). Used for ambient-fill (no-effect) options: the
// caller passes the neighborhood-ring mean color so the part region
// visually erases by adopting its surroundings.
async function writeSolidFillPng(outPath, opts) {
  const { maskAlpha, maskChannels, sceneW, box, color } = opts;
  const out = Buffer.alloc(box.width * box.height * 4);
  for (let dy = 0; dy < box.height; dy++) {
    const sy = box.y + dy;
    for (let dx = 0; dx < box.width; dx++) {
      const sx = box.x + dx;
      const srcI = sy * sceneW + sx;
      const dstI = (dy * box.width + dx) * 4;
      out[dstI] = color.r;
      out[dstI + 1] = color.g;
      out[dstI + 2] = color.b;
      out[dstI + 3] = maskAlpha[srcI * maskChannels + (maskChannels - 1)];
    }
  }
  await ensureDir(outPath);
  await sharp(out, { raw: { width: box.width, height: box.height, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(outPath);
}

async function main() {
  const overridesRaw = await readFile(OVERRIDES, "utf-8");
  const overridesFile = JSON.parse(overridesRaw);
  if (overridesFile?.version !== 1) {
    throw new Error(
      `${OVERRIDES} version mismatch (expected 1, got ${overridesFile?.version})`,
    );
  }
  const overrides = overridesFile.overrides ?? {};
  const tintBaseConfig = overridesFile.tintBase ?? {};

  // Optional designer-owned variant-mapping overrides applied AFTER workbook
  // parsing. Missing file = no overrides, no warnings.
  let variantMapping = null;
  try {
    const raw = await readFile(VARIANT_MAPPING, "utf-8");
    variantMapping = JSON.parse(raw);
    if (variantMapping?.version !== 1) {
      throw new Error(
        `${VARIANT_MAPPING} version mismatch (expected 1, got ${variantMapping?.version})`,
      );
    }
  } catch (err) {
    if (err && err.code !== "ENOENT") throw err;
  }

  const scene = JSON.parse(await readFile(SCENE_JSON, "utf-8"));
  const partsManifest = JSON.parse(await readFile(PARTS_JSON, "utf-8"));
  const partById = new Map(partsManifest.parts.map((p) => [p.id, p]));

  const optionsFile = JSON.parse(await readFile(OPTIONS_JSON, "utf-8"));
  const options = optionsFile.options;

  // Optional sheets manifest — when present, every texture-mode option on a
  // variant-enabled sheet gets a `textureUrlByVariant` map populated for
  // every variant key declared on the scene (independent of the per-option
  // overrides).
  let sheetsManifest = null;
  try {
    const raw = await readFile(SHEETS_JSON, "utf-8");
    sheetsManifest = JSON.parse(raw);
  } catch {
    // optional
  }
  const variantEnabledSheets = new Set(
    (sheetsManifest?.sheets ?? [])
      .filter((s) => s.variantsEnabled)
      .map((s) => s.key),
  );
  const sceneVariantKeys = (scene.variants ?? []).map((v) => v.key);

  // Pre-load every variant referenced by the per-option override config AND
  // every variant declared on the scene (so we can populate textureUrlByVariant
  // for variant-enabled sheets).
  const variantsToLoad = new Set();
  for (const partOv of Object.values(overrides)) {
    for (const variant of Object.values(partOv)) variantsToLoad.add(variant);
  }
  for (const k of sceneVariantKeys) variantsToLoad.add(k);
  const variantCache = new Map();
  for (const v of variantsToLoad) {
    const loaded = await loadVariantBase(v, scene.width, scene.height);
    variantCache.set(v, loaded);
  }

  const warnings = [];
  let cutFiles = 0;
  let optionsRewritten = 0;
  let autoRewritten = 0;
  // Cache per-(partId, variant) shared crop info so we can populate
  // `textureUrlByVariant` later without re-cutting.
  const sharedCropByPartVariant = new Map(); // key: `${partId}|${variantKey}` → { url, textureBox }
  // Track option ids whose textureUrl was rewritten by the manual override
  // config; auto-derive (below) skips these so manual config keeps priority.
  const manuallyRewrittenIds = new Set();

  // ----- variant-mapping overrides -----
  // Apply BEFORE the per-option base-variant overrides so that the resulting
  // `defaultForVariants` shape feeds correctly into auto-derive below. Three
  // independent sub-blocks: `overrides` (re-claim variants), cross-sheet
  // synthesis for unmatched labels, and `colorHexByVariant` (for color-mode).
  // `noEffect` is consumed in a later loop (after textureUrlByVariant).
  let variantMappingApplied = 0;
  let synthesizedCount = 0;
  if (variantMapping?.overrides) {
    for (const [partId, byVariant] of Object.entries(variantMapping.overrides)) {
      for (const [variantKey, optionLabel] of Object.entries(byVariant)) {
        if (!sceneVariantKeys.includes(variantKey)) {
          warnings.push({
            kind: "unknown-variant-key",
            partId,
            variantKey,
            optionLabel,
            message: `variant-mapping override references unknown variant "${variantKey}" (scene declares: ${sceneVariantKeys.join(", ")})`,
          });
          continue;
        }
        // Locate the option on the primary sheet by (partId, label).
        let target = options.find(
          (o) => o.partId === partId && o.sheet === PRIMARY_SHEET && o.label === optionLabel,
        );
        if (!target) {
          // Cross-sheet synthesis: search all other sheets for the same
          // (partId, label) and copy.
          const donor = options.find(
            (o) => o.partId === partId && o.label === optionLabel,
          );
          if (!donor) {
            warnings.push({
              kind: "missing-overridden-option",
              partId,
              variantKey,
              optionLabel,
              message: `variant-mapping override references option label "${optionLabel}" (partId=${partId}) that exists on no sheet — variant ${variantKey} left unclaimed`,
            });
            continue;
          }
          // Synthesize a new option on the primary sheet.
          const newId = `${partId}-urb-syn-${optionLabel}`;
          target = {
            ...donor,
            id: newId,
            sheet: PRIMARY_SHEET,
            defaultForVariants: [],
            synthesized: true,
          };
          // Drop any donor-sheet textureUrlByVariant entries; they'll be
          // re-derived for the primary sheet's variants below.
          delete target.textureUrlByVariant;
          options.push(target);
          synthesizedCount++;
        }
        // Add variantKey to the target's defaultForVariants (idempotent).
        if (!target.defaultForVariants.includes(variantKey)) {
          target.defaultForVariants.push(variantKey);
        }
        // Strip the variantKey from any other option on the same (partId, sheet).
        for (const opt of options) {
          if (opt === target) continue;
          if (opt.partId !== partId || opt.sheet !== PRIMARY_SHEET) continue;
          opt.defaultForVariants = opt.defaultForVariants.filter((k) => k !== variantKey);
        }
        variantMappingApplied++;
      }
    }
  }

  // colorHexByVariant block: copy designer-curated per-variant hex values
  // into matching color-mode options on the primary sheet.
  if (variantMapping?.colorHexByVariant) {
    for (const [partId, byLabel] of Object.entries(variantMapping.colorHexByVariant)) {
      for (const [optionLabel, hexByVariant] of Object.entries(byLabel)) {
        const target = options.find(
          (o) => o.partId === partId && o.sheet === PRIMARY_SHEET && o.label === optionLabel,
        );
        if (!target) {
          warnings.push({
            kind: "missing-color-hex-option",
            partId,
            optionLabel,
            message: `colorHexByVariant references missing option (partId=${partId}, label=${JSON.stringify(optionLabel)})`,
          });
          continue;
        }
        if (!target.colorHex) {
          warnings.push({
            kind: "color-hex-on-texture",
            partId,
            optionLabel,
            message: `colorHexByVariant cannot apply to texture-mode option (id=${target.id})`,
          });
          continue;
        }
        target.colorHexByVariant = { ...hexByVariant };
      }
    }
  }

  for (const [partId, ovByLabel] of Object.entries(overrides)) {
    const part = partById.get(partId);
    if (!part) {
      warnings.push({
        kind: "unknown-part",
        partId,
        message: `parts.json has no part "${partId}" referenced by overrides`,
      });
      continue;
    }
    const maskInfo = await loadMaskAlpha(part.mask, scene.width, scene.height);
    const box = polygonBbox(partOuterVertices(part), scene.width, scene.height);

    for (const [optionLabel, variantKey] of Object.entries(ovByLabel)) {
      const variant = variantCache.get(variantKey);
      if (!variant) {
        warnings.push({
          kind: "variant-missing",
          partId,
          optionLabel,
          variantKey,
          message: `resources/base/ベースパース_${variantKey}.jpg does not exist; option's textureUrl unchanged`,
        });
        continue;
      }
      const matching = options.filter(
        (o) => o.partId === partId && o.label === optionLabel,
      );
      if (matching.length === 0) {
        warnings.push({
          kind: "no-matching-option",
          partId,
          optionLabel,
          message: `no option in finish-options.json matched (partId=${partId}, label=${JSON.stringify(optionLabel)})`,
        });
        continue;
      }

      // One shared output per (partId, variant) — every matching option
      // (typically one per sheet) references this file.
      const sharedRel = `/assets/finishes/${partId}/_v_${variantKey}.png`;
      const sharedAbs = resolve(ROOT, "public", sharedRel.replace(/^\//, ""));
      await writeCroppedPng(sharedAbs, {
        variantRgb: variant.data,
        maskAlpha: maskInfo.data,
        maskChannels: maskInfo.channels,
        sceneW: scene.width,
        box,
      });
      cutFiles++;
      const sharedBox = { x: box.x, y: box.y, width: box.width, height: box.height };
      sharedCropByPartVariant.set(`${partId}|${variantKey}`, {
        url: sharedRel,
        textureBox: sharedBox,
      });
      for (const opt of matching) {
        opt.textureUrl = sharedRel;
        opt.textureBox = sharedBox;
        manuallyRewrittenIds.add(opt.id);
        optionsRewritten++;
      }
    }
  }

  // Populate `textureUrlByVariant` for every texture-mode option on a
  // variant-enabled sheet. For each scene variant key, ensure a shared
  // (partId, variant) cut exists; reuse it across every option (different
  // labels on the same partId all map to the same crop). When a variant
  // base is missing on disk, append a `variant-missing` warning naming
  // every affected option.
  if (variantEnabledSheets.size > 0 && sceneVariantKeys.length > 0) {
    for (const opt of options) {
      if (opt.colorHex && !opt.textureUrl) continue;
      if (!variantEnabledSheets.has(opt.sheet)) continue;
      const part = partById.get(opt.partId);
      if (!part) continue;
      const map = {};
      for (const variantKey of sceneVariantKeys) {
        const cacheKey = `${opt.partId}|${variantKey}`;
        let entry = sharedCropByPartVariant.get(cacheKey);
        if (!entry) {
          const variant = variantCache.get(variantKey);
          if (!variant) {
            warnings.push({
              kind: "variant-missing",
              partId: opt.partId,
              optionId: opt.id,
              variantKey,
              message: `resources/base/ベースパース_${variantKey}.jpg missing; option ${opt.id} skipped for variant ${variantKey}`,
            });
            continue;
          }
          const maskInfo = await loadMaskAlpha(part.mask, scene.width, scene.height);
          const box = polygonBbox(partOuterVertices(part), scene.width, scene.height);
          const sharedRel = `/assets/finishes/${opt.partId}/_v_${variantKey}.png`;
          const sharedAbs = resolve(ROOT, "public", sharedRel.replace(/^\//, ""));
          await writeCroppedPng(sharedAbs, {
            variantRgb: variant.data,
            maskAlpha: maskInfo.data,
            maskChannels: maskInfo.channels,
            sceneW: scene.width,
            box,
          });
          cutFiles++;
          entry = {
            url: sharedRel,
            textureBox: { x: box.x, y: box.y, width: box.width, height: box.height },
          };
          sharedCropByPartVariant.set(cacheKey, entry);
        }
        map[variantKey] = entry;
      }
      if (Object.keys(map).length > 0) {
        opt.textureUrlByVariant = map;
      }

      // Auto-derive `textureUrl` from `defaultForVariants`. The static
      // `textureUrl` is the fallback the runtime renders when the user is
      // viewing a variant the option does NOT claim (so the option's
      // visual identity is preserved across switches). Pick the option's
      // first claimed variant (workbook order: Natural / Flat / Sharp) so
      // multi-variant collapses (e.g. ⑭ シルバー = ["natural","flat"])
      // get a sensible base. Skip when the manual override config has
      // already set `textureUrl`.
      if (
        Array.isArray(opt.defaultForVariants) &&
        opt.defaultForVariants.length >= 1 &&
        !manuallyRewrittenIds.has(opt.id)
      ) {
        const variantKey = opt.defaultForVariants[0];
        const entry = map[variantKey];
        if (entry) {
          opt.textureUrl = entry.url;
          opt.textureBox = entry.textureBox;
          autoRewritten++;
        }
      }
    }
  }

  // ----- tint-base alternative rendering -----
  // For each part declared in `tintBase`, find the named tint-base option,
  // load its claimed variant's masked crop, convert to monotone luminance,
  // multiply by each alternative option's icon color, and write three
  // byte-identical PNGs (one per scene variant key) so the runtime's
  // per-variant texture lookup stays uniform.
  let tintedFiles = 0;
  let tintedOptions = 0;
  let shadingsLifted = 0;
  for (const [partId, tintCfg] of Object.entries(tintBaseConfig)) {
    const part = partById.get(partId);
    if (!part) {
      warnings.push({
        kind: "unknown-part",
        partId,
        message: `tintBase references unknown partId "${partId}"`,
      });
      continue;
    }
    // Color-mode shading lift: when tintCfg has no `label`, the part must
    // be color-mode and we lift its shading_<id>.png in-place.
    if (!tintCfg.label) {
      if (part.renderMode !== "color" || !part.shading) {
        warnings.push({
          kind: "tint-base-needs-shading",
          partId,
          message: `tintBase[${partId}] omits "label" so it targets color-mode shading, but part is not color-mode or has no shading file`,
        });
        continue;
      }
      const shadingPath = resolve(SCENE_DIR, part.shading);
      if (!(await exists(shadingPath))) {
        warnings.push({
          kind: "tint-base-missing-shading",
          partId,
          message: `tintBase[${partId}] shading file ${part.shading} not found; run seed:masks first`,
        });
        continue;
      }
      const lift = typeof tintCfg.lift === "number" ? tintCfg.lift : 0;
      if (lift <= 0) continue;
      // Make the lift idempotent: keep the original (un-lifted) shading
      // alongside the active file as `<name>.orig.png`. Re-runs always lift
      // from the original, never from a previously lifted output.
      const origPath = shadingPath.replace(/\.png$/, ".orig.png");
      if (!(await exists(origPath))) {
        await sharp(shadingPath).png({ compressionLevel: 9 }).toFile(origPath);
      }
      const { data, info } = await sharp(origPath)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const channels = info.channels;
      const lifted = Buffer.alloc(data.length);
      for (let i = 0; i < info.width * info.height; i++) {
        // Shading is grayscale (R = G = B), so just lift the luminance.
        const y = data[i * channels];
        const yLifted = Math.min(255, Math.round(y + (255 - y) * lift));
        lifted[i * channels] = yLifted;
        lifted[i * channels + 1] = yLifted;
        lifted[i * channels + 2] = yLifted;
        if (channels === 4) lifted[i * channels + 3] = data[i * channels + 3];
      }
      await sharp(lifted, { raw: { width: info.width, height: info.height, channels } })
        .png({ compressionLevel: 9 })
        .toFile(shadingPath);
      shadingsLifted++;
      continue;
    }
    const tintOption = options.find(
      (o) => o.partId === partId && o.sheet === PRIMARY_SHEET && o.label === tintCfg.label,
    );
    if (!tintOption) {
      warnings.push({
        kind: "tint-base-missing-option",
        partId,
        label: tintCfg.label,
        message: `tintBase[${partId}] references option label "${tintCfg.label}" not found on ${PRIMARY_SHEET}`,
      });
      continue;
    }
    if (!tintOption.defaultForVariants || tintOption.defaultForVariants.length !== 1) {
      warnings.push({
        kind: "tint-base-ambiguous-variant",
        partId,
        label: tintCfg.label,
        defaultForVariants: tintOption.defaultForVariants,
        message: `tintBase[${partId}] option "${tintCfg.label}" must claim exactly one variant; got ${JSON.stringify(tintOption.defaultForVariants)}`,
      });
      continue;
    }
    const tintVariantKey = tintOption.defaultForVariants[0];
    const tintVariant = variantCache.get(tintVariantKey);
    if (!tintVariant) {
      warnings.push({
        kind: "variant-missing",
        partId,
        variantKey: tintVariantKey,
        message: `tintBase[${partId}] variant "${tintVariantKey}" base image missing`,
      });
      continue;
    }
    const maskInfo = await loadMaskAlpha(part.mask, scene.width, scene.height);
    const box = polygonBbox(partOuterVertices(part), scene.width, scene.height);

    // For every alternative option (defaultForVariants empty) on this part
    // on the primary sheet, generate per-variant tinted PNGs.
    const alternatives = options.filter(
      (o) =>
        o.partId === partId &&
        o.sheet === PRIMARY_SHEET &&
        Array.isArray(o.defaultForVariants) &&
        o.defaultForVariants.length === 0,
    );
    for (const alt of alternatives) {
      if (!alt.iconUrl) {
        warnings.push({
          kind: "tint-color-no-icon",
          partId,
          optionId: alt.id,
          message: `alternative ${alt.id} has no iconUrl; tint-base skipped`,
        });
        continue;
      }
      const iconAbs = resolve(ROOT, "public", alt.iconUrl.replace(/^\//, ""));
      if (!(await exists(iconAbs))) {
        warnings.push({
          kind: "tint-color-icon-missing",
          partId,
          optionId: alt.id,
          iconUrl: alt.iconUrl,
          message: `alternative ${alt.id} iconUrl ${alt.iconUrl} does not exist on disk`,
        });
        continue;
      }
      const tint = await dominantNonWhiteColor(iconAbs);
      if (tint.confidence < 0.05) {
        warnings.push({
          kind: "tint-color-low-confidence",
          partId,
          optionId: alt.id,
          confidence: tint.confidence,
          message: `alternative ${alt.id} icon has <5% non-white pixels (confidence=${tint.confidence.toFixed(3)}); tint may be unreliable`,
        });
      }
      const tintMap = {};
      const lift = typeof tintCfg.lift === "number" ? tintCfg.lift : 0;
      for (const variantKey of sceneVariantKeys) {
        const outRel = `/assets/finishes/${partId}/${alt.id}__${variantKey}.png`;
        const outAbs = resolve(ROOT, "public", outRel.replace(/^\//, ""));
        await writeTintedPng(outAbs, {
          variantRgb: tintVariant.data,
          maskAlpha: maskInfo.data,
          maskChannels: maskInfo.channels,
          sceneW: scene.width,
          box,
          tint,
          lift,
        });
        tintedFiles++;
        tintMap[variantKey] = {
          url: outRel,
          textureBox: { x: box.x, y: box.y, width: box.width, height: box.height },
        };
      }
      alt.textureUrlByVariant = tintMap;
      // Also point static textureUrl at the tint-base variant's PNG so
      // viewing this option without active variant still shows the tint.
      const fallback = tintMap[tintVariantKey];
      if (fallback) {
        alt.textureUrl = fallback.url;
        alt.textureBox = fallback.textureBox;
      }
      tintedOptions++;
    }
  }

  // ----- ambient-fill (noEffect) options -----
  // For each (partId, optionLabel) in noEffect, sample a neighborhood ring
  // around the part mask in every variant base and emit a solid-fill PNG
  // per variant so the part visually erases by adopting its surroundings.
  let noEffectFiles = 0;
  let noEffectOptions = 0;
  if (variantMapping?.noEffect) {
    for (const entry of variantMapping.noEffect) {
      const part = partById.get(entry.partId);
      if (!part) {
        warnings.push({
          kind: "unknown-part",
          partId: entry.partId,
          message: `noEffect references unknown partId "${entry.partId}"`,
        });
        continue;
      }
      const target = options.find(
        (o) => o.partId === entry.partId && o.sheet === PRIMARY_SHEET && o.label === entry.optionLabel,
      );
      if (!target) {
        warnings.push({
          kind: "missing-no-effect-option",
          partId: entry.partId,
          optionLabel: entry.optionLabel,
          message: `noEffect references missing option (partId=${entry.partId}, label=${JSON.stringify(entry.optionLabel)})`,
        });
        continue;
      }
      const maskInfo = await loadMaskAlpha(part.mask, scene.width, scene.height);
      // Per-entry tunables: the bbox needs to expand when `dilate` is large
      // enough to push the sampling ring outside the part's natural bbox.
      const dilatePx = typeof entry.dilate === "number" ? entry.dilate : 16;
      const dim = typeof entry.dim === "number" ? entry.dim : 1.0;
      const targetHex = typeof entry.targetHex === "string" ? entry.targetHex : null;
      const partOuter = partOuterVertices(part);
      const partBbox = polygonBbox(partOuter, scene.width, scene.height);
      // Expand the sampling box outward by dilatePx so the ring scan can
      // reach far-from-bloom pixels. The output PNG still uses the natural
      // partBbox (the part-region geometry doesn't change).
      const sampleBox = {
        x: Math.max(0, partBbox.x - dilatePx),
        y: Math.max(0, partBbox.y - dilatePx),
        width: 0,
        height: 0,
      };
      sampleBox.width = Math.min(scene.width, partBbox.x + partBbox.width + dilatePx) - sampleBox.x;
      sampleBox.height = Math.min(scene.height, partBbox.y + partBbox.height + dilatePx) - sampleBox.y;
      const box = partBbox;
      const noEffectMap = {};
      for (const variantKey of sceneVariantKeys) {
        const variant = variantCache.get(variantKey);
        if (!variant) continue;
        let color;
        if (targetHex) {
          const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(targetHex);
          color = m
            ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
            : { r: 128, g: 128, b: 128 };
        } else {
          color = neighborhoodRingMean(
            variant.data,
            maskInfo.data,
            maskInfo.channels,
            scene.width,
            sampleBox,
            dilatePx,
          );
        }
        if (dim !== 1.0) {
          color = {
            r: Math.max(0, Math.min(255, Math.round(color.r * dim))),
            g: Math.max(0, Math.min(255, Math.round(color.g * dim))),
            b: Math.max(0, Math.min(255, Math.round(color.b * dim))),
          };
        }
        const outRel = `/assets/finishes/${entry.partId}/${target.id}__${variantKey}.png`;
        const outAbs = resolve(ROOT, "public", outRel.replace(/^\//, ""));
        await writeSolidFillPng(outAbs, {
          maskAlpha: maskInfo.data,
          maskChannels: maskInfo.channels,
          sceneW: scene.width,
          box,
          color,
        });
        noEffectFiles++;
        noEffectMap[variantKey] = {
          url: outRel,
          textureBox: { x: box.x, y: box.y, width: box.width, height: box.height },
        };
      }
      target.textureUrlByVariant = noEffectMap;
      const firstKey = sceneVariantKeys[0];
      const fallback = firstKey ? noEffectMap[firstKey] : undefined;
      if (fallback) {
        target.textureUrl = fallback.url;
        target.textureBox = fallback.textureBox;
      }
      noEffectOptions++;
    }
  }

  // Strip any pre-existing variant-cutter warnings before appending fresh ones.
  let prevWarnings = [];
  try {
    const raw = await readFile(WARNINGS_JSON, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) prevWarnings = parsed;
  } catch {
    // no warnings file yet
  }
  const filtered = prevWarnings.filter(
    (w) =>
      w?.kind !== "variant-missing" &&
      w?.kind !== "no-matching-option" &&
      w?.kind !== "unknown-part" &&
      w?.kind !== "unknown-variant-key" &&
      w?.kind !== "missing-overridden-option" &&
      w?.kind !== "missing-color-hex-option" &&
      w?.kind !== "color-hex-on-texture" &&
      w?.kind !== "tint-base-missing-option" &&
      w?.kind !== "tint-base-ambiguous-variant" &&
      w?.kind !== "tint-base-needs-shading" &&
      w?.kind !== "tint-base-missing-shading" &&
      w?.kind !== "tint-color-no-icon" &&
      w?.kind !== "tint-color-icon-missing" &&
      w?.kind !== "tint-color-low-confidence" &&
      w?.kind !== "missing-no-effect-option",
  );
  const merged = [...filtered, ...warnings];

  await writeFile(
    OPTIONS_JSON,
    JSON.stringify({ version: 1, options }, null, 2) + "\n",
  );
  await writeFile(WARNINGS_JSON, JSON.stringify(merged, null, 2) + "\n");

  if (variantMapping) {
    const overriddenParts = Object.keys(variantMapping.overrides ?? {}).sort();
    const colorHexParts = Object.keys(variantMapping.colorHexByVariant ?? {}).sort();
    const noEffectCount = (variantMapping.noEffect ?? []).length;
    console.log(
      `✓ variant-mapping: ${variantMappingApplied} (partId, variantKey) re-claims across [${overriddenParts.join(", ")}] · ${synthesizedCount} synthesized option(s) · ${colorHexParts.length} part(s) with colorHexByVariant · ${noEffectCount} noEffect entry(ies)`,
    );
  }
  console.log(
    `✓ wrote ${cutFiles} shared (partId, variant) PNG(s); ${optionsRewritten} options rewritten via manual config + ${autoRewritten} auto-derived from defaultForVariants`,
  );
  if (tintedOptions > 0 || noEffectOptions > 0 || shadingsLifted > 0) {
    console.log(
      `✓ tint-base: ${tintedOptions} alt option(s) → ${tintedFiles} PNG(s); ${shadingsLifted} shading(s) lifted in-place; ambient-fill: ${noEffectOptions} option(s) → ${noEffectFiles} PNG(s)`,
    );
  }
  console.log(
    `✓ ${warnings.length} variant-cutter warnings appended to ${WARNINGS_JSON}`,
  );
  for (const w of warnings.slice(0, 10)) {
    console.log(`  ! ${w.kind}: ${w.message}`);
  }
  if (warnings.length > 10) console.log(`  … (${warnings.length - 10} more)`);

  // Exit non-zero on variant-missing so the runtime does not attempt to
  // load with a partial catalog.
  const variantMissing = warnings.filter((w) => w.kind === "variant-missing");
  if (variantMissing.length > 0) {
    console.error(
      `✗ ${variantMissing.length} variant-missing warning(s); resolve before booting the runtime.`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
