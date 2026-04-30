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
const RESOURCES_BASE = resolve(ROOT, "resources/base");

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

async function main() {
  const overridesRaw = await readFile(OVERRIDES, "utf-8");
  const overridesFile = JSON.parse(overridesRaw);
  if (overridesFile?.version !== 1) {
    throw new Error(
      `${OVERRIDES} version mismatch (expected 1, got ${overridesFile?.version})`,
    );
  }
  const overrides = overridesFile.overrides ?? {};

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
  // Cache per-(partId, variant) shared crop info so we can populate
  // `textureUrlByVariant` later without re-cutting.
  const sharedCropByPartVariant = new Map(); // key: `${partId}|${variantKey}` → { url, textureBox }

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
      w?.kind !== "unknown-part",
  );
  const merged = [...filtered, ...warnings];

  await writeFile(
    OPTIONS_JSON,
    JSON.stringify({ version: 1, options }, null, 2) + "\n",
  );
  await writeFile(WARNINGS_JSON, JSON.stringify(merged, null, 2) + "\n");

  console.log(
    `✓ wrote ${cutFiles} shared (partId, variant) PNG(s); rewrote ${optionsRewritten} option entries`,
  );
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
