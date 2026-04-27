import {
  sceneSchema,
  scenesIndexSchema,
  type Scene,
  type SceneIndexEntry,
  type ScenesIndex,
} from "./types";

export class SceneLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SceneLoadError";
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw new SceneLoadError(`Failed to fetch ${url}: HTTP ${res.status}`);
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

export async function loadScenesIndex(
  url = "/assets/base/scenes.json",
): Promise<ScenesIndex> {
  const raw = await fetchJson(url);
  const result = scenesIndexSchema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new SceneLoadError(
      `Scenes index invalid at ${first.path.join(".") || "<root>"}: ${first.message}`,
    );
  }
  return result.data;
}

export function pickDefaultScene(index: ScenesIndex): SceneIndexEntry {
  const def = index.scenes.find((s) => s.default === true);
  if (!def) {
    // Schema refinement should have caught this, but keep a defensive throw.
    throw new SceneLoadError("Scenes index has no default scene");
  }
  return def;
}

export async function loadScene(manifestUrl: string): Promise<Scene> {
  const raw = await fetchJson(manifestUrl);
  const result = sceneSchema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new SceneLoadError(
      `Scene manifest at ${manifestUrl} invalid at ${first.path.join(".") || "<root>"}: ${first.message}`,
    );
  }
  const scene = result.data;

  const [baseOk, partsOk] = await Promise.all([
    probeAsset(scene.baseImageUrl),
    probeAsset(scene.partsManifestUrl),
  ]);
  if (!baseOk) {
    throw new SceneLoadError(
      `Scene "${scene.id}" base image not found at ${scene.baseImageUrl}`,
    );
  }
  if (!partsOk) {
    throw new SceneLoadError(
      `Scene "${scene.id}" parts manifest not found at ${scene.partsManifestUrl}`,
    );
  }

  return scene;
}
