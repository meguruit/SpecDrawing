import {
  partsManifestSchema,
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

export async function loadPartsForScene(scene: Scene): Promise<Part[]> {
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
  const manifest: PartsManifest = result.data;

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

  return manifest.parts;
}
