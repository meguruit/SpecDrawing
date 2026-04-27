import {
  finishOptionsFileSchema,
  type FinishOption,
  type SheetName,
} from "./schema";
import type { Part } from "@/lib/parts/types";

export class FinishesLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinishesLoadError";
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new FinishesLoadError(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  return res.json();
}

export async function loadFinishOptions(
  url = "/catalog/finish-options.json",
): Promise<FinishOption[]> {
  const raw = await fetchJson(url);
  const result = finishOptionsFileSchema.safeParse(raw);
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
  return result.data.options;
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

export function availableSheets(options: FinishOption[]): SheetName[] {
  return Array.from(new Set(options.map((o) => o.sheet))).sort();
}
