## 1. Dev API route

- [x] 1.1 Create `app/api/dev/parts/route.ts` with `GET` and `PUT` handlers that 404 unless `process.env.NODE_ENV === "development"`
- [x] 1.2 `GET /api/dev/parts` reads `public/assets/base/main/parts.json` from disk and returns `{ manifest, mtime }`
- [x] 1.3 `GET /api/dev/parts?source=extracted` reads `/tmp/parts-extracted.json` and returns `{ manifest }` or 404 with a message naming the script
- [x] 1.4 `PUT /api/dev/parts` validates body against `partsManifestSchema` (Zod) and responds 422 with `{ field, message }` on failure
- [x] 1.5 On valid PUT, atomic write: `parts.json.tmp` → rename `parts.json` to `parts.json.bak` → rename `.tmp` to `parts.json`; respond `{ savedAt, mtime }`
- [x] 1.6 Add `public/assets/base/main/parts.json.bak` to `.gitignore` (also `parts.json.tmp` for crash safety)

## 2. localStorage draft layer

- [x] 2.1 Add `lib/dev/draftStore.ts` with `loadDraft(sceneId)`, `saveDraft(sceneId, manifest)`, `clearDraft(sceneId)`, using key `dev:trace:parts:<sceneId>`
- [x] 2.2 Each draft entry stores `{ manifest, savedAt: ISO string }`
- [x] 2.3 `lib/dev/draftStore.ts` no-ops gracefully when `window` is not available (SSR safety)

## 3. Mount-time draft restoration

- [x] 3.1 Add `components/dev/RestoreDraftPrompt.tsx` — non-blocking inline prompt naming both timestamps with "復元 / 破棄" buttons
- [x] 3.2 In `TraceTool.client.tsx`, on mount: `GET /api/dev/parts` + read draft; if `draft.savedAt > mtime + 2s` show prompt; otherwise load disk + clear draft
- [x] 3.3 Wire prompt actions to load draft (mark dirty) or clear draft (load disk)

## 4. Autosave wiring

- [x] 4.1 In `TraceTool.client.tsx`, on every manifest mutation: write to localStorage immediately
- [x] 4.2 Debounce 600 ms then `PUT /api/dev/parts` with the current manifest
- [x] 4.3 On success: surface "保存済み HH:MM:SS" in side panel; clear localStorage draft (verified: badge updated within 1 s of vertex deletion)
- [x] 4.4 On 422: surface the Zod field/message in side-panel error region; do NOT clear draft
- [x] 4.5 On network failure: surface "ローカルに保持中（再送信を試行...）"; retry every 2 s up to 1 minute; keep draft

## 5. Edge-midpoint vertex insertion

- [x] 5.1 Add a helper `nearestEdge(polygon, point, tolerancePx)` returning `{ edgeIndex, foot } | null` (in `lib/dev/geometry.ts`)
- [x] 5.2 In the stage click handler: when click is within 12 px of an edge of the editing part, insert at the perpendicular foot between the two endpoints (shift subsequent indices)
- [x] 5.3 Otherwise fall through to existing append-to-end behavior

## 6. Undo / Redo

- [x] 6.1 Add `lib/dev/history.ts`: capped stack (depth 30) of `(editingId, polygon[], marker)` triples with `push`, `undo`, `redo`, `canUndo`, `canRedo`
- [x] 6.2 Push on terminal mutations only: vertex add, vertex delete, vertex drag-end, marker drag-end, polygon-clear, extractor-import
- [x] 6.3 Push a checkpoint on `setEditingId` change
- [x] 6.4 Bind `Cmd/Ctrl+Z` (undo) and `Cmd/Ctrl+Shift+Z` (redo) at window level, ignoring when typing in INPUT/TEXTAREA/SELECT
- [x] 6.5 Add Undo / Redo buttons to the side panel; disable when stack at boundary (verified: undo enabled after vertex delete)

## 7. Extractor import

- [x] 7.1 Add an "Import from extractor" button in the header
- [x] 7.2 On click: `GET /api/dev/parts?source=extracted`; on 404, surface "先に `node scripts/extract-pdf-polygons.mjs` を実行してください"
- [x] 7.3 Open `components/dev/ExtractorImportPanel.tsx` listing each part with current vs. extracted (vertex count, bbox, marker coords) and per-part toggles for polygon + marker (verified: panel renders all 17 parts)
- [x] 7.4 "Apply selected" mutates the manifest and pushes one history entry per imported part; close the panel with a message naming the count

## 8. Other-part visibility toggle

- [x] 8.1 Add a 3-state toggle (`all` / `current` / `hidden`) in the header; default `all` (placed in the header rather than side panel for easier access alongside other tool-mode controls)
- [x] 8.2 Persist the choice in `localStorage["dev:trace:visibility"]`
- [x] 8.3 Update the rendering: `all` keeps current dashed outlines; `current` hides all non-editing outlines; `hidden` also hides the editing part's marker (verified: switching to `current` hides faint dashed outlines)

## 9a. Auto-regenerate masks + shading after save (added in response to a runtime bug)

- [x] 9a.1 Extract mask + shading generation into `lib/dev/regenAssets.ts` (server-only, sharp + node:fs); export `regenPartsAssets({ sceneDir, width, height, baseRgb, parts })`
- [x] 9a.2 Add `app/api/dev/parts/regen/route.ts` POST handler (dev-gated)
- [x] 9a.3 In `TraceTool.client.tsx`, after each successful autosave PUT schedule a 1.5-s debounced `POST /api/dev/parts/regen` via `scheduleRegen()`
- [x] 9a.4 Surface regen state in the header
- [x] 9a.5 Smoke: edit a vertex on part 7 in `/dev/trace`; verify within ~2 s that `mask_07.png` and `shading_07.png` mtimes update

## 9b. Cache-bust mask + shading URLs by per-part `_rev` (D13)

- [x] 9b.1 Add a `partRevision(part)` helper in `lib/parts/load.ts` (FNV-1a 32-bit of `JSON.stringify(polygon) + "|" + mask + "|" + (shading ?? "")`)
- [x] 9b.2 In `loadPartsForScene`, attach `_rev` to every returned part
- [x] 9b.3 In `components/parts/PartFinishLayer.tsx`, append `?v=<_rev>` to mask + shading URLs via a small `bust(url, rev)` helper
- [x] 9b.4 Smoke: load `/`, verify network requests are `mask_07.png?v=<rev>`; edit polygon ⑦; reload; verify the `?v=` query string changed and the visual finish updates

## 9c. Click pass-through on editing-part polygon Line (D14)

- [x] 9c.1 Add `listening={false}` to the editing-part `<Line>` in `TraceTool.client.tsx`
- [x] 9c.2 Smoke: with ⑦ selected, click an empty area inside the polygon → new vertex appended; click within 12 px of an edge → midpoint inserted; right-click a vertex Circle → vertex deleted

## 9d. Header layout stable through status transitions (D15)

- [x] 9d.1 Wrap SaveBadge + RegenBadge in a fixed-width (200 px) column with `whitespace-nowrap`
- [x] 9d.2 Shorten regen done text to "マスク更新 <N>件 HH:MM:SS"; move "メイン画面はリロードで反映" reminder to `title` attribute
- [x] 9d.3 Smoke: trigger an edit and verify header bounding-rect height stays constant through `idle → saving → saved → scheduled → running → done` (verified: header 52 px before and after; canvas Y position unchanged)

## 9e. Per-part hash sidecar + force-regen safety valve (D11, D12)

- [x] 9e.1 Replace the `.bak`-based diff in `app/api/dev/parts/regen/route.ts` with a per-part hash sidecar at `public/assets/base/main/parts.json.regen.json`
- [x] 9e.2 Compute current per-part hash with the same FNV-1a function shared with the runtime `_rev` (D13) — ensures sidecar and cache-bust hashes stay in lock-step
- [x] 9e.3 Atomic sidecar write (`.tmp` + `rename`); preserve hash entries for unchanged parts on partial regen
- [x] 9e.4 Add `?force=true` query param that skips the sidecar diff and regenerates every part; update the sidecar to record every part's current hash on completion
- [x] 9e.5 Add a "全マスク再生成" button to the `/dev/trace` header that POSTs `?force=true`
- [x] 9e.6 Add `parts.json.regen.json` and `parts.json.regen.json.tmp` to `.gitignore`
- [x] 9e.7 One-shot reconciliation: run `npm run seed:masks` to fully regen all 17 masks against the current `parts.json`; verify with bbox comparison that all parts now match (verified: 14/17 perfectly aligned; 3/17 within Gaussian-blur feather tolerance ≤ 15 px)
- [x] 9e.8 Smoke: click "全マスク再生成" → badge shows "マスク更新 17件 HH:MM:SS"; subsequent diff POST returns `{ regenerated: [], mode: "diff", durationMs: 0 }` (sidecar is in sync)

## 9. Acknowledge D10 carve-out in design

- [x] 9.1 In this change's `design.md` D2, the dev API carve-out is documented; future contributors reading the prior change's D10 should read D2 alongside

## 10. Manual smoke + docs

- [x] 10.1 `npm run typecheck` and `npm run lint` pass
- [x] 10.2 `openspec validate enhance-dev-trace` passes
- [x] 10.3 Smoke checklist:
  - [x] Edit a vertex on part 1, wait 1 s, hard-reload (Cmd+R) → edit persists (verified: vertex deleted, reload showed 3 vertices)
  - [x] API round-trip via `fetch` direct (PUT 200, savedAt timestamp returned, atomic write produced `.bak`)
  - [x] Extractor import panel renders all 17 parts with current vs. extracted comparison; per-part toggles work (verified visually)
  - [x] Visibility toggle to `current` removes other-part outlines (verified: kitchen ① shows polygon outline alone)
  - [x] `npm run build` succeeds; `/api/dev/parts` route registers with size `0 B` (production build doesn't ship route logic surface beyond the 404 path)
  - [ ] Production runtime gating (`next build && next start` → 404 on `/api/dev/parts`) — code path is the same `process.env.NODE_ENV !== "development"` check used in dev; standalone production smoke deferred
  - [ ] Network-failure → "ローカルに保持中" smoke — code path is in place but not directly exercised in this session (would require stopping the dev server mid-edit)
- [x] 10.4 Update `resources/reference/AUTHORING.md` with the new workflow notes (autosave / draft restore / extractor import / vertex insertion / undo / visibility toggle)
