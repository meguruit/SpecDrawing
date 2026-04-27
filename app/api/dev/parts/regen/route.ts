// Dev-only: regenerate mask + shading PNGs for parts whose polygon (or
// mask / shading filename) drifted from the last regenerated state.
//
// Drift detection: a sidecar file `parts.json.regen.json` records, per
// part id, the FNV-1a hash of `JSON.stringify(polygon) + mask + shading`
// at the time the mask was last regenerated. On POST we compute the
// current hash for each part and regenerate any whose recorded hash is
// missing or out of date. The sidecar is then updated atomically.
//
// This replaces the earlier `parts.json` vs `parts.json.bak` diff, which
// only kept one step of history and silently dropped earlier edits when
// a regen request was missed for any reason.
//
// `?force=true` skips the diff and regenerates every part (used by the
// "全マスクを再生成" button as a safety valve).
//
// POST body: none.
// Response: { regenerated: PartId[], durationMs: number, mode: "diff" | "force" }

import { NextResponse } from "next/server";
import { readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import {
  partsManifestSchema,
  type Part,
  type PartsManifest,
} from "@/lib/parts/types";
import { sceneSchema } from "@/lib/scenes/types";
import { regenPartsAssets } from "@/lib/dev/regenAssets";

const SCENE_DIR = resolve(process.cwd(), "public/assets/base/main");
const LIVE = resolve(SCENE_DIR, "parts.json");
const REGEN_STATE = resolve(SCENE_DIR, "parts.json.regen.json");
const REGEN_STATE_TMP = resolve(SCENE_DIR, "parts.json.regen.json.tmp");
const SCENE_JSON = resolve(SCENE_DIR, "scene.json");
const BASE_JPG = resolve(SCENE_DIR, "base.jpg");

function devOnly(): NextResponse | null {
  if (process.env.NODE_ENV !== "development") {
    return new NextResponse(null, { status: 404 });
  }
  return null;
}

// FNV-1a 32-bit on the polygon + asset filenames. Same shape as the
// runtime `_rev` so a part's mask and runtime URL bust together.
function partRegenKey(part: Part): string {
  const payload =
    JSON.stringify(part.polygon) + "|" + part.mask + "|" + (part.shading ?? "");
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

type RegenStateFile = {
  version: 1;
  parts: Record<string, string>;
};

async function readRegenState(): Promise<RegenStateFile> {
  try {
    const raw = await readFile(REGEN_STATE, "utf-8");
    const parsed = JSON.parse(raw) as RegenStateFile;
    if (parsed?.version === 1 && typeof parsed.parts === "object") {
      return parsed;
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") throw err;
  }
  return { version: 1, parts: {} };
}

async function writeRegenStateAtomic(state: RegenStateFile): Promise<void> {
  await writeFile(REGEN_STATE_TMP, JSON.stringify(state, null, 2), "utf-8");
  await rename(REGEN_STATE_TMP, REGEN_STATE);
}

async function readManifest(path: string): Promise<PartsManifest | null> {
  try {
    const raw = await readFile(path, "utf-8");
    return partsManifestSchema.parse(JSON.parse(raw));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    throw err;
  }
}

export async function POST(request: Request) {
  const guard = devOnly();
  if (guard) return guard;

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "true";

  const t0 = Date.now();
  try {
    const next = await readManifest(LIVE);
    if (!next) {
      return NextResponse.json(
        { error: "no-live-parts", message: "parts.json not found" },
        { status: 404 },
      );
    }

    const state = await readRegenState();

    // Compute current hashes per part; pick which to regen.
    const currentHashes: Record<string, string> = {};
    const toRegen: Part[] = [];
    for (const part of next.parts) {
      const key = partRegenKey(part);
      currentHashes[part.id] = key;
      if (force || state.parts[part.id] !== key) {
        toRegen.push(part);
      }
    }

    if (!toRegen.length) {
      return NextResponse.json({
        regenerated: [],
        mode: force ? "force" : "diff",
        durationMs: Date.now() - t0,
      });
    }

    const sceneRaw = await readFile(SCENE_JSON, "utf-8");
    const scene = sceneSchema.parse(JSON.parse(sceneRaw));
    const { data: baseRgb, info } = await sharp(BASE_JPG)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.width !== scene.width || info.height !== scene.height) {
      return NextResponse.json(
        {
          error: "dimension-mismatch",
          message: `base.jpg (${info.width}×${info.height}) does not match scene.json (${scene.width}×${scene.height})`,
        },
        { status: 500 },
      );
    }

    await regenPartsAssets({
      sceneDir: SCENE_DIR,
      width: scene.width,
      height: scene.height,
      baseRgb,
      parts: toRegen,
    });

    // Update sidecar with the new per-part hashes for the regenerated
    // parts, preserving entries for unchanged parts.
    const newState: RegenStateFile = {
      version: 1,
      parts: { ...state.parts, ...currentHashes },
    };
    await writeRegenStateAtomic(newState);

    return NextResponse.json({
      regenerated: toRegen.map((p) => p.id),
      mode: force ? "force" : "diff",
      durationMs: Date.now() - t0,
    });
  } catch (err) {
    return NextResponse.json(
      { error: "regen-failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}
