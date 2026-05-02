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
import { partsManifestSchema, normalizePart } from "@/lib/parts/types";
import { pointInRing } from "@/lib/parts/hitTest";

const SCENE_DIR = resolve(process.cwd(), "public/assets/base/main");
const LIVE = resolve(SCENE_DIR, "parts.json");
const TMP = resolve(SCENE_DIR, "parts.json.tmp");
const BAK = resolve(SCENE_DIR, "parts.json.bak");
const EXTRACTED = "/tmp/parts-extracted.json";

function devOnly(): NextResponse | null {
  const isLocalDev = process.env.NODE_ENV === "development";
  const isVercelPreview = process.env.VERCEL_ENV === "preview";
  if (!isLocalDev && !isVercelPreview) {
    return new NextResponse(null, { status: 404 });
  }
  return null;
}

// Vercel's serverless runtime mounts the deployed app as a read-only
// filesystem (only /tmp is writable, and even that is per-instance and
// ephemeral). Any attempt to writeFile/rename under public/ on a preview
// deploy fails with EROFS. Bail before touching disk so the client gets a
// clear 503 + "preview-readonly" code instead of a 500 that triggers a
// 60-second retry loop. Local dev (`process.env.VERCEL` unset) is unaffected.
function previewReadOnly(): NextResponse | null {
  if (process.env.VERCEL === "1") {
    return NextResponse.json(
      {
        error: "preview-readonly",
        message:
          "プレビュー環境ではディスクへ保存できません。ヘッダの「ダウンロード」から parts.json を取得し、ブランチへコミットしてください。",
      },
      { status: 503 },
    );
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
    const json = JSON.parse(raw);
    // Normalize legacy `polygon` to `polygons: [{ outer }]` so the client
    // (TraceTool) always sees the runtime shape regardless of whether
    // migration has been run on disk yet.
    const parsed = partsManifestSchema.safeParse(json);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return NextResponse.json(
        {
          error: "invalid-on-disk",
          field: first.path.join("."),
          message: first.message,
        },
        { status: 500 },
      );
    }
    const manifest = {
      version: parsed.data.version,
      parts: parsed.data.parts.map((p) => normalizePart(p)),
    };
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
  const ro = previewReadOnly();
  if (ro) return ro;

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

  // Soft geometric-validity warning: a hole whose first vertex sits
  // outside its parent's outer is almost always an authoring mistake.
  // We do NOT reject — even-odd fill produces a defined output regardless,
  // and rejecting would block the designer mid-edit. Just surface a note.
  const warnings: Array<{ partId: string; polygonIndex: number; holeIndex: number }> = [];
  for (const raw of parsed.data.parts) {
    const part = normalizePart(raw);
    part.polygons.forEach((poly, pi) => {
      poly.holes?.forEach((hole, hi) => {
        if (hole.length === 0) return;
        const [hx, hy] = hole[0];
        if (!pointInRing(hx, hy, poly.outer)) {
          warnings.push({ partId: part.id, polygonIndex: pi, holeIndex: hi });
        }
      });
    });
  }

  // On Vercel preview the deployed filesystem is read-only — the PUT cannot
  // persist back to disk. Validate the manifest (above) and return success so
  // the client's autosave clears the "ローカルに保持中" state; the user's
  // localStorage mirror plus the manual "ダウンロード" → commit workflow is the
  // canonical persistence path on preview (see resources/reference/AUTHORING.md).
  if (process.env.VERCEL_ENV === "preview") {
    const savedAt = new Date().toISOString();
    return NextResponse.json({
      savedAt,
      mtime: savedAt,
      warnings: warnings.length ? warnings : undefined,
    });
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
      warnings: warnings.length ? warnings : undefined,
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
