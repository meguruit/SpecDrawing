import {
  sceneSchema,
  scenesIndexSchema,
  type Scene,
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

  // Verify each declared part has its mask + shading file present.
  for (const part of scene.parts) {
    const [maskOk, shadingOk] = await Promise.all([
      probeAsset(part.maskUrl),
      probeAsset(part.shadingUrl),
    ]);
    if (!maskOk) {
      throw new SceneLoadError(
        `Scene "${scene.id}" part "${part.id}" mask not found at ${part.maskUrl}`,
      );
    }
    if (!shadingOk) {
      throw new SceneLoadError(
        `Scene "${scene.id}" part "${part.id}" shading not found at ${part.shadingUrl}`,
      );
    }
  }

  // Probe base too so we fail loudly instead of silently rendering nothing.
  if (!(await probeAsset(scene.baseImageUrl))) {
    throw new SceneLoadError(
      `Scene "${scene.id}" base image not found at ${scene.baseImageUrl}`,
    );
  }

  return scene;
}
