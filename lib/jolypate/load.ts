import {
  jolypateCatalogSchema,
  JOLYPATE_CATEGORY_ORDER,
  type JolypateCatalog,
  type JolypateCategory,
  type JolypateColor,
} from "./schema";

export class JolypateLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JolypateLoadError";
  }
}

/**
 * Load and validate the Jolypate colour catalogue.
 *
 * Validation failure names the offending colour number and field and throws:
 * a partially applied catalogue would silently hide colours from the picker,
 * which is worse than not loading at all.
 */
export async function loadJolypateColors(
  url = "/catalog/jolypate-colors.json",
): Promise<JolypateCatalog> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new JolypateLoadError(
      `ジョリパッドカラーカタログを取得できません (${url}): HTTP ${res.status}`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(await res.text());
  } catch (err) {
    throw new JolypateLoadError(
      `ジョリパッドカラーカタログが JSON として不正です: ${(err as Error).message}`,
    );
  }

  const result = jolypateCatalogSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    // Name the entry by its colour number rather than array index — the index
    // is meaningless to whoever has to fix the catalogue.
    const path = issue.path;
    let where = path.join(".");
    if (path[0] === "colors" && typeof path[1] === "number") {
      const entry = (parsed as JolypateCatalog | undefined)?.colors?.[path[1]];
      const code = entry?.code ?? `#${path[1]}`;
      where = `色番 ${code} の ${path.slice(2).join(".") || "エントリ"}`;
    }
    throw new JolypateLoadError(
      `ジョリパッドカラーカタログの検証に失敗しました: ${where}: ${issue.message}`,
    );
  }

  const seen = new Set<string>();
  for (const c of result.data.colors) {
    if (seen.has(c.code)) {
      throw new JolypateLoadError(
        `ジョリパッドカラーカタログに色番 ${c.code} が重複しています`,
      );
    }
    seen.add(c.code);
  }

  return result.data;
}

export type JolypateGroup = {
  category: JolypateCategory;
  colors: JolypateColor[];
};

/** Group colours by category in the printed catalogue's order, dropping empty groups. */
export function groupByCategory(
  colors: ReadonlyArray<JolypateColor>,
): JolypateGroup[] {
  return JOLYPATE_CATEGORY_ORDER.map((category) => ({
    category,
    colors: colors.filter((c) => c.category === category),
  })).filter((g) => g.colors.length > 0);
}

/**
 * Case-insensitive substring match over the colour number and the Japanese
 * name. An empty query matches everything.
 */
export function filterColors(
  colors: ReadonlyArray<JolypateColor>,
  query: string,
): JolypateColor[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...colors];
  return colors.filter(
    (c) =>
      c.code.toLowerCase().includes(q) ||
      (c.nameJa ? c.nameJa.toLowerCase().includes(q) : false),
  );
}

/** Look up one colour by its catalogue number. */
export function findByCode(
  colors: ReadonlyArray<JolypateColor>,
  code: string | null,
): JolypateColor | null {
  if (!code) return null;
  return colors.find((c) => c.code === code) ?? null;
}
