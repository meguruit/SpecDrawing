// Dev-only file persistence for /dev/trace. Gated to NODE_ENV === "development";
// returns 404 in production. Reads/writes exactly public/assets/base/main/parts.json
// (and rolling parts.json.bak). On `?source=extracted`, GET reads the polygon
// hint output from /tmp/parts-extracted.json (script `extract-pdf-polygons.mjs`).
//
// Atomic write strategy: write to .tmp, rename live → .bak, rename .tmp → live.
// PUT body validated against the runtime Zod schema before any disk touch.

import { NextResponse } from "next/server";
import { readFile, writeFile, rename, stat, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { partsManifestSchema } from "@/lib/parts/types";

const SCENE_DIR = resolve(process.cwd(), "public/assets/base/main");
const LIVE = resolve(SCENE_DIR, "parts.json");
const TMP = resolve(SCENE_DIR, "parts.json.tmp");
const BAK = resolve(SCENE_DIR, "parts.json.bak");
const EXTRACTED = "/tmp/parts-extracted.json";

function devOnly(): NextResponse | null {
  if (process.env.NODE_ENV !== "development") {
    return new NextResponse(null, { status: 404 });
  }
  return null;
}

export async function GET(request: Request) {
  const guard = devOnly();
  if (guard) return guard;

  const url = new URL(request.url);
  const source = url.searchParams.get("source");
  if (source === "extracted") {
    try {
      const raw = await readFile(EXTRACTED, "utf-8");
      const manifest = JSON.parse(raw);
      return NextResponse.json({ manifest });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return NextResponse.json(
          {
            error: "extracted-not-found",
            message:
              "/tmp/parts-extracted.json が見つかりません。先に `node scripts/extract-pdf-polygons.mjs` を実行してください。",
          },
          { status: 404 },
        );
      }
      return NextResponse.json(
        { error: "read-failed", message: (err as Error).message },
        { status: 500 },
      );
    }
  }

  try {
    const [raw, st] = await Promise.all([
      readFile(LIVE, "utf-8"),
      stat(LIVE),
    ]);
    const manifest = JSON.parse(raw);
    return NextResponse.json({ manifest, mtime: st.mtime.toISOString() });
  } catch (err) {
    return NextResponse.json(
      { error: "read-failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  const guard = devOnly();
  if (guard) return guard;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid-json", message: "Request body is not valid JSON" },
      { status: 400 },
    );
  }

  const parsed = partsManifestSchema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      {
        error: "validation-failed",
        field: first.path.join("."),
        message: first.message,
      },
      { status: 422 },
    );
  }

  const serialized = JSON.stringify(parsed.data, null, 2) + "\n";

  try {
    // 1. Write to .tmp
    await writeFile(TMP, serialized, "utf-8");
    // 2. Move existing live → .bak (overwriting any prior .bak); ignore ENOENT.
    try {
      await rename(LIVE, BAK);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw err;
    }
    // 3. Promote .tmp → live.
    await rename(TMP, LIVE);
    const st = await stat(LIVE);
    return NextResponse.json({
      savedAt: new Date().toISOString(),
      mtime: st.mtime.toISOString(),
    });
  } catch (err) {
    // Best-effort cleanup of stray .tmp on failure.
    try {
      await unlink(TMP);
    } catch {
      // ignore
    }
    return NextResponse.json(
      { error: "write-failed", message: (err as Error).message },
      { status: 500 },
    );
  }
}
