import {
  partsManifestSchema,
  normalizePart,
  type Part,
  type PartsManifest,
} from "./types";
import type { Scene } from "@/lib/scenes/types";

export class PartsLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PartsLoadError";
  }
}

// Tiny non-cryptographic hash used only as a cache-buster for mask /
// shading URLs. We don't need collision resistance — we need a string
// that changes whenever the part's polygons (or asset filenames) change,
// so the browser refetches mask_<id>.png after /dev/trace edits + regen.
function partRevision(part: Part): string {
  const payload =
    JSON.stringify(part.polygons) + "|" + part.mask + "|" + (part.shading ?? "");
  let h = 0x811c9dc5; // FNV-1a 32-bit offset basis
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193); // FNV prime
  }
  return (h >>> 0).toString(36);
}

export type PartWithRevision = Part & { _rev: string };

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new PartsLoadError(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  return res.json();
}

async function probeAsset(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: "HEAD", cache: "no-store" });
    return res.ok;
  } catch {
    return false;
  }
}

export function resolveAssetUrl(scene: Scene, filename: string): string {
  // mask / shading are stored as filenames relative to the scene directory.
  // The scene's partsManifestUrl is typically `/assets/base/<id>/parts.json`,
  // so its directory is the scene's asset directory.
  const i = scene.partsManifestUrl.lastIndexOf("/");
  const dir = i >= 0 ? scene.partsManifestUrl.slice(0, i) : "";
  return `${dir}/${filename}`;
}

export async function loadPartsForScene(
  scene: Scene,
): Promise<PartWithRevision[]> {
  const raw = await fetchJson(scene.partsManifestUrl);
  const result = partsManifestSchema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new PartsLoadError(
      `Parts manifest for scene "${scene.id}" invalid at ${
        first.path.join(".") || "<root>"
      }: ${first.message}`,
    );
  }
  // Normalize each part: collapse legacy `polygon` into `polygons: [{ outer }]`.
  // Dev-only deprecation warning steers contributors to the migration script.
  const normalized = result.data.parts.map((raw) =>
    normalizePart(raw, (id) => {
      if (process.env.NODE_ENV === "development") {
        console.warn(
          `[parts] scene "${scene.id}" part ${id} uses legacy single-polygon shape; ` +
            "run `npm run migrate:multiring` to migrate.",
        );
      }
    }),
  );
  const manifest: PartsManifest = {
    version: result.data.version,
    parts: normalized,
  };

  // Reject duplicate ids.
  const seen = new Set<string>();
  for (const p of manifest.parts) {
    if (seen.has(p.id)) {
      throw new PartsLoadError(
        `Parts manifest for scene "${scene.id}" has duplicate id "${p.id}"`,
      );
    }
    seen.add(p.id);
  }

  // Probe every declared mask and shading file.
  await Promise.all(
    manifest.parts.map(async (p) => {
      const checks: Array<[string, string]> = [
        ["mask", resolveAssetUrl(scene, p.mask)],
      ];
      if (p.renderMode === "color" && p.shading) {
        checks.push(["shading", resolveAssetUrl(scene, p.shading)]);
      }
      for (const [kind, url] of checks) {
        if (!(await probeAsset(url))) {
          throw new PartsLoadError(
            `Scene "${scene.id}" part "${p.id}" ${kind} not found at ${url}`,
          );
        }
      }
    }),
  );

  // Attach a per-part revision derived from polygon + asset filenames so
  // the runtime can cache-bust mask / shading URLs after /dev/trace edits.
  // The browser's image cache is keyed by URL; without a query string,
  // it serves the previously-loaded mask even after the file on disk
  // changes (especially survives an in-tab reload via React's module
  // cache for `useImageCache`). Appending `?v=<_rev>` invalidates per part.
  return manifest.parts.map((p) => ({
    ...p,
    _rev: partRevision(p),
  }));
}
