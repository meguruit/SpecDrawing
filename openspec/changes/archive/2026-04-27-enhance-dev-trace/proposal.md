## Why

`/dev/trace` is the designer tool that produces the per-part polygons in `public/assets/base/main/parts.json`. Today it loses all in-progress edits the moment the page reloads — Next.js HMR fires when source changes, the user hits F5, the browser crashes, or the workflow's own "ダウンロード → ファイル差し替え → 手動リロード" cycle wipes any edits to other parts that weren't yet flushed. This makes refining 17 numbered parts a fragile, all-or-nothing session: one accidental save kills hours of placement work. On top of the persistence pain, the placeholder rectangles shipped in the previous change are coarse enough that designers will spend a lot of time inserting and rearranging vertices, but the current UI only supports appending vertices at the end of the polygon and offers no undo path, no way to import the PDF-extractor's polygon hints (`/tmp/parts-extracted.json`), and no way to declutter the canvas of other parts' overlays while focusing on one region.

## What Changes

- **Persistence (the headline)**: `/dev/trace` edits MUST survive page reloads. Add a development-only Next.js API route (`/api/dev/parts`) that reads and writes `public/assets/base/main/parts.json` on disk, gated to `NODE_ENV === "development"` so it 404s in production. Edits are debounced and pushed to disk continuously; on every keystroke a localStorage mirror is updated so transient API failures don't lose work. On mount, the tool prefers a localStorage draft newer than the on-disk version (with an explicit "復元しますか？" prompt naming the timestamps).
- **Atomic disk writes** with a one-deep `.bak` of the previous `parts.json` before each successful overwrite, plus Zod validation on the write path so a malformed payload can never corrupt the live manifest.
- **Edge-midpoint vertex insertion**: clicking on a polygon edge (between two existing vertices) inserts a new vertex at that point, instead of always appending to the end. Append-on-empty-stage-click stays for fresh polygons.
- **Undo / Redo** with `Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z`, scoped to the active part (switching parts pushes a checkpoint). History depth ≥ 30.
- **Import from extractor**: a button reads `/tmp/parts-extracted.json` (via the same dev API) and lets the designer merge polygons / markers per-part with a confirm-each-overwrite UX, so the PDF-extractor's hints can be used as a starting point per part instead of an all-or-nothing replacement.
- **Other-part visibility toggle**: a 3-state switch (all dashed / current part only / hidden) replaces the current always-on faint-dashed rendering, so designers can isolate the part they're working on without canvas noise.
- **Acknowledge the no-backend deviation**: design.md adds a D-entry that scopes the new API route as a dev-only designer aid, consistent with the spirit of the redesign change's D10 ("no production backend") rather than a true production API.
- **Auto-regenerate mask + shading after save** so the runtime at `/` actually reflects polygon edits without a manual `npm run seed:masks`. A POST to `/api/dev/parts/regen` runs ~1.5 s after the autosave PUT settles, regenerating only the parts whose polygon (or asset filenames) drifted from a per-part hash sidecar (`parts.json.regen.json`). A `?force=true` variant skips the sidecar diff and rebuilds every mask, exposed in the header as a "全マスク再生成" button — the safety valve when sidecar state itself drifts (manual `parts.json` edit, file restored from `git`, etc.). The sidecar is local state only; gitignored.
- **Cache-bust mask/shading URLs by per-part `_rev`** so the runtime image cache (and the browser image cache) cannot serve a stale `mask_<id>.png` after a /dev/trace edit. `loadPartsForScene` attaches a per-part FNV-1a hash of `polygon + mask + shading` to each part as `_rev`; `PartFinishLayer` appends `?v=<_rev>` to the asset URLs it hands to `useImage`. Same hash scheme as the regen sidecar so the two stay in lock-step.
- **Click pass-through fix**: the editing-part polygon `<Line>` ships with `listening={false}` so its semi-transparent fill no longer captures clicks inside the polygon. Click-to-add-vertex, edge-midpoint insertion, and right-click-vertex-delete all reach the Stage handler / vertex Circle reliably.
- **Stable header layout**: save badge and regen badge live in a fixed-width column with `whitespace-nowrap` so the header height never shifts as status transitions through saving / saved / regen states; long reminders move to `title` tooltips.

Explicit non-goals:

- No production-time persistence (the API is 404 in production).
- No multi-user / concurrent editing — single designer, single session at a time.
- No file-system operations beyond `parts.json` + `parts.json.bak` (the masks / shading / textures stay seed-script driven).
- No remote sync / git operations from the tool — designer still commits manually.
- No new scenes-management UI — `/dev/trace` continues to operate on the default scene.

## Capabilities

### New Capabilities
- `dev-trace-tool`: The designer tool at `/dev/trace` that loads, displays, and edits a scene's `parts.json` — including the dev-only API route that persists edits to disk, the editing UX (vertex insertion, undo/redo, marker drag, polygon clear, extractor import, visibility toggle), and the localStorage draft layer.

### Modified Capabilities
<!-- None — /dev/trace was added in the prior change as an unspecified designer aid; this change formalizes it as a capability for the first time. -->

## Impact

- **New code**:
  - `app/api/dev/parts/route.ts` (GET + PUT, dev-gated)
  - `app/api/dev/parts/regen/route.ts` (POST, dev-gated, with `?force=true`; reads/writes `parts.json.regen.json` sidecar)
  - `lib/dev/draftStore.ts` (localStorage wrapper)
  - `lib/dev/history.ts` (undo/redo stack)
  - `lib/dev/geometry.ts` (`nearestEdge` for edge-midpoint vertex insertion)
  - `lib/dev/regenAssets.ts` (server-only mask + shading rasterization shared with the seed:masks script)
  - `components/dev/RestoreDraftPrompt.tsx`, `components/dev/ExtractorImportPanel.tsx`
  - Substantial rewrite of `app/dev/trace/TraceTool.client.tsx` to thread through autosave + history + edge insertion + visibility toggle + extractor import + auto-regen + force-regen
  - Targeted edits to `lib/parts/load.ts` (attach `_rev`) and `components/parts/PartFinishLayer.tsx` (cache-bust URLs)
- **No new runtime deps**. The API route uses Node's `fs/promises` and `sharp` (already a devDep). Zod is already a dep.
- **No production impact**: the API route returns 404 outside development, so production bundles / deploys are unchanged. The `/dev/trace` page itself was already not part of the production demo flow.
- **Spec relationship**: this change introduces the first formal spec for `/dev/trace`. The previous (archived) change `redesign-numbered-part-finish-picker` left it as a deferred designer-tool task (3.6) with no requirements; this change closes that gap.
- **Touches `parts.json`** at runtime only when the designer is actively editing in development. Production fetches the committed file as before.
- **`.gitignore`**: `public/assets/base/main/parts.json.bak` (rolling backup), `parts.json.tmp` (atomic-write scratch), `parts.json.regen.json` (per-part regen hash sidecar), and `parts.json.regen.json.tmp` are all added to `.gitignore` so local state never enters git.
