import {
  finishOptionsFileSchema,
  sheetsManifestSchema,
  type FinishOption,
  type SheetName,
  type SheetConfig,
  type SheetsManifest,
} from "./schema";
import type { Part } from "@/lib/parts/types";
import type { Scene } from "@/lib/scenes/types";

export class FinishesLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinishesLoadError";
  }
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new FinishesLoadError(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  return res.text();
}

// FNV-1a 32-bit. Same shape as the parts.json `_rev` cache-bust so the
// runtime can append `?v=<rev>` to texture URLs after seed:variants
// rewrites them. Re-running the seed step changes the catalog body,
// which changes this hash, which busts the cached image.
function catalogRevision(jsonBody: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < jsonBody.length; i++) {
    h ^= jsonBody.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export type LoadedFinishOptions = {
  options: FinishOption[];
  /** Cache-bust hash for textureUrl appendages on the runtime. */
  _rev: string;
};

export async function loadFinishOptions(
  url = "/catalog/finish-options.json",
): Promise<LoadedFinishOptions> {
  const raw = await fetchText(url);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new FinishesLoadError(
      `Finish options file is not valid JSON: ${(err as Error).message}`,
    );
  }
  const result = finishOptionsFileSchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new FinishesLoadError(
      `Finish options file invalid at ${
        first.path.join(".") || "<root>"
      }: ${first.message}`,
    );
  }
  // Reject duplicate ids.
  const seen = new Set<string>();
  for (const opt of result.data.options) {
    if (seen.has(opt.id)) {
      throw new FinishesLoadError(
        `Finish options file has duplicate id "${opt.id}"`,
      );
    }
    seen.add(opt.id);
  }
  return { options: result.data.options, _rev: catalogRevision(raw) };
}

/**
 * Cross-validate that every option's `colorHex`/`textureUrl` shape matches
 * its part's `renderMode`. Throws on the first mismatch.
 */
export function crossValidateAgainstParts(
  options: FinishOption[],
  parts: Part[],
): void {
  const partById = new Map(parts.map((p) => [p.id, p]));
  for (const opt of options) {
    const part = partById.get(opt.partId);
    if (!part) {
      // Unknown partId is permitted (option could belong to a different scene),
      // but if you wanted strict scene-scoped catalogs, change to throw.
      continue;
    }
    if (part.renderMode === "color" && !opt.colorHex) {
      throw new FinishesLoadError(
        `Option "${opt.id}" targets color-mode part "${opt.partId}" but has no colorHex`,
      );
    }
    if (part.renderMode === "texture" && !opt.textureUrl) {
      throw new FinishesLoadError(
        `Option "${opt.id}" targets texture-mode part "${opt.partId}" but has no textureUrl`,
      );
    }
  }
}

export function getOptionsForPart(
  options: FinishOption[],
  partId: string,
  sheet: SheetName,
): FinishOption[] {
  return options.filter((o) => o.partId === partId && o.sheet === sheet);
}

/**
 * Returns the workbook-first option for `(partId, sheet)`, i.e. the seed
 * pipeline's default. `null` when the pair has no options. Used by the
 * Excel spec-sheet export to fill rows the user has not actively touched.
 */
export function getDefaultOptionId(
  options: FinishOption[],
  partId: string,
  sheet: SheetName,
): string | null {
  const list = getOptionsForPart(options, partId, sheet);
  return list[0]?.id ?? null;
}

export function availableSheets(options: FinishOption[]): SheetName[] {
  return Array.from(new Set(options.map((o) => o.sheet))).sort();
}

export async function loadSheetsManifest(
  url = "/catalog/sheets.json",
): Promise<SheetsManifest> {
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) {
    // Sheets manifest is optional for back-compat — when absent, all sheets
    // are treated as variant-disabled and the runtime variant switcher is
    // not surfaced.
    return { version: 1, sheets: [] } as SheetsManifest;
  }
  if (!res.ok) {
    throw new FinishesLoadError(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  const parsed = await res.json();
  const result = sheetsManifestSchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new FinishesLoadError(
      `Sheets manifest invalid at ${first.path.join(".") || "<root>"}: ${first.message}`,
    );
  }
  return result.data;
}

export function getSheetConfig(
  manifest: SheetsManifest,
  sheet: SheetName,
): SheetConfig | undefined {
  return manifest.sheets.find((s) => s.key === sheet);
}

/**
 * Cross-validate sheet manifest against scene variants:
 * - any sheet with `variantsEnabled === true` MUST have a `defaultVariantKey`
 *   that resolves to a variant on the scene.
 */
export function crossValidateSheetsAgainstScene(
  manifest: SheetsManifest,
  scene: Scene,
): void {
  const variantKeys = new Set(scene.variants.map((v) => v.key));
  for (const s of manifest.sheets) {
    if (s.variantsEnabled) {
      if (!s.defaultVariantKey) {
        throw new FinishesLoadError(
          `Sheet "${s.key}" has variantsEnabled: true but no defaultVariantKey`,
        );
      }
      if (!variantKeys.has(s.defaultVariantKey)) {
        throw new FinishesLoadError(
          `Sheet "${s.key}" defaultVariantKey "${s.defaultVariantKey}" does not match any variant on scene "${scene.id}"`,
        );
      }
    }
  }
}

/**
 * Cross-validate that, for any sheet with `variantsEnabled === true`, every
 * texture-mode option targeting a part on that sheet declares
 * `textureUrlByVariant` covering every scene variant key.
 *
 * `mode: "warn"` logs each violation via console.warn instead of throwing —
 * used during the workbook migration so the runtime can boot while the
 * customer-prepared 部材リスト.xlsx has not yet been re-issued.
 * `mode: "strict"` throws on the first violation (target end state).
 */
export function crossValidateOptionsAgainstSheets(
  options: FinishOption[],
  parts: Part[],
  manifest: SheetsManifest,
  scene: Scene,
  mode: "strict" | "warn" = "strict",
): void {
  const partById = new Map(parts.map((p) => [p.id, p]));
  const sheetByKey = new Map(manifest.sheets.map((s) => [s.key, s]));
  const variantKeys = scene.variants.map((v) => v.key);
  const report = (msg: string) => {
    if (mode === "strict") throw new FinishesLoadError(msg);
    if (typeof console !== "undefined") console.warn(`[finishes] ${msg}`);
  };
  for (const opt of options) {
    const part = partById.get(opt.partId);
    if (!part || part.renderMode !== "texture") continue;
    const sheet = sheetByKey.get(opt.sheet);
    if (!sheet?.variantsEnabled) continue;
    if (!opt.textureUrlByVariant) {
      report(
        `Option "${opt.id}" lives on variant-enabled sheet "${opt.sheet}" but has no textureUrlByVariant`,
      );
      continue;
    }
    for (const key of variantKeys) {
      if (!opt.textureUrlByVariant[key]) {
        report(
          `Option "${opt.id}" textureUrlByVariant is missing variant key "${key}"`,
        );
      }
    }
  }
}

/**
 * Cross-validate parts manifest against the active scene's primary sheet
 * config: when `variantsEnabled === true`, every non-accent-cloth part on
 * that scene MUST be `renderMode: "texture"`. Accent-cloth parts (`07`
 * キッチンアクセントクロス, `16` 収納アクセントクロス) MUST stay color-mode.
 */
const ACCENT_CLOTH_PART_IDS = new Set(["07", "16"]);

export function crossValidatePartsAgainstSheets(
  parts: Part[],
  manifest: SheetsManifest,
  scene: Scene,
  mode: "strict" | "warn" = "strict",
): void {
  // The scene's "primary" sheet here is any sheet that opts into variants.
  // If at least one variant-enabled sheet covers this scene, the texture-as-
  // default policy applies.
  const variantSheetExists = manifest.sheets.some((s) => s.variantsEnabled);
  if (!variantSheetExists || scene.variants.length === 0) return;
  const report = (msg: string) => {
    if (mode === "strict") throw new FinishesLoadError(msg);
    if (typeof console !== "undefined") console.warn(`[finishes] ${msg}`);
  };
  for (const p of parts) {
    if (ACCENT_CLOTH_PART_IDS.has(p.id)) {
      if (p.renderMode !== "color") {
        report(
          `Scene "${scene.id}" part "${p.id}" must be color-mode (accent cloth) but is "${p.renderMode}"`,
        );
      }
    } else {
      if (p.renderMode !== "texture") {
        report(
          `Scene "${scene.id}" part "${p.id}" must be texture-mode under the variant-enabled policy but is "${p.renderMode}"`,
        );
      }
    }
  }
}
