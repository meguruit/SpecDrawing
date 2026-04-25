import {
  materialCatalogSchema,
  type MaterialCatalog,
  type MaterialEntry,
} from "./schema";

export class CatalogLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogLoadError";
  }
}

export async function loadCatalog(
  url = "/catalog/materials.json",
): Promise<MaterialCatalog> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new CatalogLoadError(
      `Failed to fetch catalog at ${url}: HTTP ${res.status}`,
    );
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch (err) {
    throw new CatalogLoadError(
      `Catalog at ${url} is not valid JSON: ${(err as Error).message}`,
    );
  }
  const result = materialCatalogSchema.safeParse(json);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first.path.join(".");
    throw new CatalogLoadError(
      `Catalog validation failed at ${path || "<root>"}: ${first.message}`,
    );
  }
  return result.data;
}

export function getEntryById(
  catalog: MaterialCatalog,
  id: string,
): MaterialEntry | undefined {
  return catalog.entries.find((e) => e.id === id);
}
