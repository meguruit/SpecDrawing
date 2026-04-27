## Context

`/dev/trace` shipped in the prior change (`redesign-numbered-part-finish-picker`, archived) as a designer-only Konva tool that loads `public/assets/base/main/parts.json`, lets a designer edit polygons + markers in-memory, and exports the edited manifest via a browser download. The placeholder polygons shipped in that change are coarse rectangles authored from a visual read of the base perspective, plus four PDF-extracted polygons (② ⑦ ⑬ ⑮) — designer time on `/dev/trace` is therefore the gating activity for shipping production-quality masks (the asset pipeline downstream re-runs cleanly via `npm run seed:masks` once `parts.json` is right).

The current persistence model is "edit in React state → click Download → drop into `public/`". This is fragile for several reasons:
- HMR fires on any source-file change → React state is wiped.
- F5 / browser crash → state is wiped.
- The Download → drop-in flow itself usually triggers a manual refresh, wiping any other parts the designer was mid-editing.
- There is no way to recover the lost work — there is no draft, no autosave, no history.

On top of persistence, the editing model has friction worth fixing while the file is open:
- Click-to-add only appends to the polygon's end. Inserting a vertex between two existing ones (the common case when refining a coarse rectangle) requires deleting + re-adding everything after, or placing the new vertex at the end and visually accepting an out-of-order edge.
- Drag accidents (especially the ~28-px marker handle) are common and unrecoverable without undo.
- The PDF extractor's output (`/tmp/parts-extracted.json`) is currently usable only via the one-shot `scripts/promote-extracted-polygons.mjs` curated whitelist. The designer cannot import polygon hints per-part interactively.
- All other parts render as faint dashed outlines simultaneously, which is helpful for context but noisy when zoomed in on one region.

The redesign change's design.md D10 established a "single Next.js tier, no backend, no Route Handlers" rule. This change adds a Next.js Route Handler under `/api/dev/`, scoped to development by `NODE_ENV` — the deviation is acknowledged in D2 below and reconciled with D10.

## Goals / Non-Goals

**Goals:**
- Edits to `/dev/trace` survive page reload, HMR, F5, browser crash, and the Download → drop → reload cycle.
- Disk write is the source of truth; localStorage is a non-blocking safety net for transient API failures.
- The dev API is invisible in production (404).
- Make the editing UX usable for the actual job: insert vertices on edges, undo mistakes, import extractor hints per-part, declutter the canvas.
- Do not change anything about the runtime app (`/`) or the asset pipeline.

**Non-Goals:**
- No production-time persistence or sync — the API is dev-only.
- No multi-user / concurrent editing — single designer assumed.
- No remote sync / git operations from the tool.
- No new scenes-management UI — operates on the active default scene only.
- No mask / shading / texture authoring — those stay seed-script driven.
- No file-system operations beyond `parts.json` + `parts.json.bak`.

## Decisions

### D1. Persistence: dev API + localStorage hybrid (not either alone)

Use both, with dev API as the source of truth and localStorage as the safety net.

```
   ┌────────────────────────────────────────────────────────────┐
   │   /dev/trace edit loop                                     │
   ├────────────────────────────────────────────────────────────┤
   │                                                            │
   │   Mount:                                                   │
   │     1. GET /api/dev/parts → disk version + mtime           │
   │     2. read localStorage draft (if any) + draft.savedAt    │
   │     3. if draft.savedAt > disk.mtime + 2s:                 │
   │          show RestoreDraftPrompt(disk.mtime, draft.savedAt)│
   │          on accept → load draft, mark dirty                │
   │          on decline → load disk, clear draft               │
   │        else load disk, clear draft                         │
   │                                                            │
   │   Edit:                                                    │
   │     React state ──► localStorage (sync, every change)      │
   │              └──► debounced 600ms ──►                      │
   │                   PUT /api/dev/parts                       │
   │                   ↓                                        │
   │                   write atomically (.tmp + rename)         │
   │                   keep one .bak copy                       │
   │                   respond { savedAt, mtime }               │
   │                   ↓                                        │
   │                   Toast "保存済み 14:32:15" + clear draft   │
   │                                                            │
   │   API failure → toast "ローカルに保持中（再送信を試行...）"  │
   │              keep retrying every 2s for up to 1 min        │
   │              localStorage draft remains until success      │
   └────────────────────────────────────────────────────────────┘
```

**Why both layers**: localStorage alone gives no git-trackable trail and no cross-machine sync; disk-only loses work the moment the API hiccups. The hybrid handles every observed failure mode. Disk wins on mtime so a `git pull` that updates `parts.json` is respected (the prompt explicitly compares timestamps).

**Alternatives considered:**
- *localStorage only*: rejected — designer can't commit without a separate export step, and a different machine sees nothing.
- *File System Access API*: rejected — Chromium-only, requires a per-session user grant, does not solve the "I just hit F5" case any better than localStorage.
- *WebSocket to dev server*: rejected — over-engineered for a single-user dev tool.

### D2. Dev API: gated by `NODE_ENV`, scoped to one file

`app/api/dev/parts/route.ts` exposes `GET` and `PUT`. Both handlers check `process.env.NODE_ENV` and respond 404 if not `"development"`. The route does not appear in production builds beyond the 404 handler shape (Next.js still generates the route, but there's no real surface).

The route reads/writes exactly `public/assets/base/main/parts.json` and its `.bak` sibling. The path is hardcoded server-side; no path traversal possible from the client (the request body contains the manifest, not a path).

**Why not a different layer**: Next.js Route Handlers are the path of least resistance in this codebase. A separate Express-style sidecar would add deps, ports, and a process to manage.

**Reconciliation with the prior change's D10**: D10 said "single Next.js tier, no backend, no Route Handlers added in this change." That rule was about *production* surface area — the rationale (no auth, no DB, no service to operate) does not apply to a dev-only file write that exists purely for designer ergonomics. The route adds zero production cost (no auth, no DB, no extra process) and 404s in production. Scoping the rule to "no production backend" is consistent with its intent. design.md adds an explicit note acknowledging this.

**Alternatives considered:**
- *No API; localStorage + manual download only*: rejected — the user has explicitly experienced the pain this leaves on the table.
- *Drop the rule entirely (allow `/api/*` broadly)*: rejected — the rule still has value for production routes; we just carve out `/api/dev/*`.

### D3. Atomic disk write + one-deep backup

PUT writes to `parts.json.tmp` first, then `rename`s onto `parts.json`. The previous `parts.json` is renamed to `parts.json.bak` before the new file lands. Only one generation of backup is kept (the script doesn't accumulate; if the designer needs deeper history they're using git).

`.gitignore` rule: `public/assets/base/main/parts.json.bak`.

**Why**: a partial write that crashes mid-flush would leave the live file invalid and break the runtime app. Atomic rename + a one-step backup makes the worst case "revert from .bak", not "manual reconstruction".

### D4. Validation on write — Zod, server-side

The PUT handler runs the request body through `partsManifestSchema` (the same Zod schema the runtime uses to load the file). On failure: respond 422 with the Zod issue path + message; do NOT touch disk. The client surfaces the message in the existing Toast and the localStorage draft is preserved.

**Why**: keeps the live `parts.json` schema-clean even if the editor's UI ever produces a malformed shape (e.g., a polygon with <3 vertices after rapid deletes).

### D5. Vertex insertion on edge clicks (not just append)

When the designer clicks the canvas inside the editing part's polygon outline (within ~12px of any edge segment), insert a new vertex at the foot of the perpendicular from the click point onto that edge segment, between its two endpoints in the polygon's vertex order. Clicks more than 12px from any edge fall through to the existing append-to-end behavior (so empty/tiny polygons are still buildable).

**Why**: 12px tolerance keeps "click near the edge to add a midpoint" intuitive without stealing the empty-area-add behavior. The perpendicular foot (vs. nearest endpoint) keeps the new vertex visually on the line.

**Alternatives considered:**
- *Right-click an edge to insert*: rejected — right-click is already used for delete on vertex handles; would conflict.
- *Modifier-key (Alt/Shift) + click*: rejected — too easy to forget; the proximity-based heuristic feels right.

### D6. Undo / Redo

A capped (depth 30) per-tool history stack of `(editingId, polygon[], marker)` triples. Each *terminal* mutation pushes a new entry: vertex add, vertex delete, vertex drag-end, marker drag-end, polygon-clear, extractor-import. Each switch of `editingId` also pushes a checkpoint so undoing past a part-switch is well-defined.

Keyboard: `Cmd/Ctrl+Z` = undo, `Cmd/Ctrl+Shift+Z` = redo. Buttons in the side panel as well.

**Scope choice**: per-tool (whole manifest), not per-part. Switching parts is itself a checkpoint, so the user can undo back across part switches if they made a wrong move and only realized after switching. This costs ~17× more memory than per-part but at depth 30 + JSON-small polygons, that's negligible (<200 KB).

**Why drag-end pushes, not drag-move**: pushing on every mousemove during a drag would balloon the stack and let one drag occupy the whole undo budget. Drag-end is the natural unit.

### D7. Extractor import: per-part, with confirm

Add an "Import from extractor" button. It calls `GET /api/dev/parts?source=extracted` which reads `/tmp/parts-extracted.json` if present (404 if not, with a clear message). On success, open a side-panel list: each part shows current vs. extracted polygon vertex count + bbox, with per-part "import polygon" and "import marker" toggles. "Apply selected" mutates the in-memory manifest (and pushes one history entry per imported part). The Toast confirms how many were imported.

**Why per-part with confirm**: the extractor's output is partial-quality (the prior session showed ~4/17 polygons + ~10/17 markers were trustworthy). Wholesale replace would regress the hand-tuned ones already in `parts.json`.

### D8. Other-part visibility: 3 modes

Replace the "always faint dashed" rendering with a 3-state toggle in the side panel:

- **all** — current behavior, all other parts shown faint dashed (default).
- **current** — only the editing part is rendered (full-saturation outline + handles + marker).
- **hidden** — only the editing part's polygon, no marker, no other parts (cleanest possible canvas for fine vertex placement).

Persist the choice in localStorage (cross-session) since it's a designer preference.

### D9. Source-of-truth conflict between localStorage draft and disk

Resolved at mount via the prompt described in D1. Concretely, the disk version's `mtime` (returned by GET) is compared against the localStorage draft's `savedAt`. If `savedAt > mtime + 2s`, show the prompt; the 2-second slop accommodates small clock drift and the autosave debounce. The user picks; the choice is final for the session (no further prompts unless mtime changes mid-session, which would only happen if someone else edited the file — out of scope).

### D10. Tests / safety nets

This is a designer tool, not production code; integration tests are not in scope. Two safety nets are in scope:

- The existing typecheck + lint passes for all new code.
- A manual smoke checklist in tasks.md (load the page, edit, force a hard reload, verify the edits are still there; force the API to fail by stopping `next dev` mid-edit, verify localStorage holds and the toast surfaces; etc.).

## Risks / Trade-offs

- **[Risk] Adding a Route Handler softens the "no backend" constraint.** → **Mitigation**: D2's NODE_ENV gate + the explicit "production cost = 0" framing keeps the original intent of D10 intact. design.md records the carve-out so future contributors don't read it as a precedent for production routes.
- **[Risk] localStorage quota / multi-tab confusion.** A second tab editing the same scene would race. → **Mitigation**: out of scope (single designer assumption). Use a single `dev:trace:parts:<sceneId>` key so different scenes don't collide if the registry ever grows.
- **[Risk] Zod validation rejects partial-state edits.** A polygon mid-edit can transiently have <3 vertices (e.g., the designer just deleted vertices and is about to add new ones). → **Mitigation**: validation runs only on the autosave PUT, not on every keystroke. The localStorage mirror has no validation so the draft is always preserved. If the autosave is rejected the toast says so and the draft hangs onto the work.
- **[Risk] `.bak` file accidentally committed.** → **Mitigation**: `.gitignore` rule.
- **[Trade-off] Edge-midpoint insertion uses a 12px proximity heuristic that may feel too loose at tight zoom or too tight at the default zoom.** → **Mitigation**: tunable constant; the value is committed in code with a comment explaining the rationale. If feedback is "wrong tolerance" we tune; not worth a UI control.
- **[Trade-off] Undo across part-switches uses one history per tool (vs. per-part).** Memory cost is trivial; the trade-off is conceptual: "what does Undo on part ⑩ do if the last action was on part ⑦?" → **Mitigation**: D6 picks the simpler model and documents it.

## Migration Plan

This is a dev-only feature with no breaking changes. Steps:

1. Land the dev API route + the new `lib/dev/*` helpers without touching `TraceTool.client.tsx` (so the existing tool keeps working).
2. Wire autosave + draft restoration into `TraceTool.client.tsx`.
3. Layer in vertex insertion + undo/redo + visibility toggle.
4. Add the extractor import surface.
5. Smoke test, document, commit, PR.

Rollback = revert the merge. There is no data migration since `parts.json` shape is unchanged.

## Open Questions

- **Q1**: Should the dev API serve other artifacts beyond `parts.json` (e.g., the seed scripts' outputs, scenes index)? Not in this change — keep scope tight to the persistence pain. If demand emerges we extend the route.
- **Q2**: Should `RestoreDraftPrompt` offer a "merge" action (per-part) or just accept/decline on the whole draft? This change ships accept/decline only. Per-part merge can come if the workflow demands it.
- **Q3**: Do we want `parts.json` change-watching on the server side so a `git pull` auto-prompts the user to discard their draft? Out of scope; an mtime check on next mount is enough.

## Decisions added during implementation (post-bug-reports)

### D11. Mask regen pipeline switched from `.bak` diff to per-part hash sidecar

**Problem discovered after first ship**: the original regen endpoint diffed `parts.json` against `parts.json.bak`. `.bak` only keeps one step of history. A direct check of all 17 mask alpha bboxes vs the corresponding polygon bboxes found 16 of 17 masks did not match the current polygons — only the most-recently-edited part was in sync. Cause: each PUT shifts `.bak` forward by one, so any single dropped regen request (network blip, dev-server restart mid-edit, manual `parts.json` edit outside the tool) silently leaves the affected part's mask permanently stale.

**Decision**: replace the `.bak`-based diff with a per-part hash sidecar at `public/assets/base/main/parts.json.regen.json`. Shape `{ version: 1, parts: { [partId]: hashString } }`. After every regen, the sidecar records the FNV-1a hash of `JSON.stringify(polygon) + "|" + mask + "|" + (shading ?? "")` for each regenerated part. The next regen call re-hashes every current part and regenerates anything whose recorded hash is missing or out of date — drift is bounded to "until the next regen call" rather than "permanent".

**Sidecar safety**:
- Atomic write via `.tmp` + `rename`.
- Gitignored (local state only).
- Hash entries for unchanged parts are preserved across writes.

**Why FNV-1a**: same hash as `loadPartsForScene` uses for the runtime `_rev` cache-bust (D13 below), so the two stay in lock-step. Non-cryptographic; collision risk is negligible for this purpose.

### D12. `?force=true` + "全マスク再生成" button as the safety valve

The sidecar itself can drift (e.g., the designer hand-edits `parts.json` outside the dev API, or restores `parts.json` from `git`). To recover, the regen endpoint accepts `?force=true` which skips the sidecar diff and rebuilds every part. After completion, the sidecar is updated so subsequent diff regens correctly return `regenerated: []`.

The header in `/dev/trace` exposes a "全マスク再生成" button that POSTs the force variant. Cost: ~5 s for 17 parts at 3000×2142, run on demand. The button is always present (not hidden behind a debug flag) — a noticeable overhead is preferable to a stale-mask demo.

### D13. Cache-bust mask + shading URLs by per-part `_rev`

**Problem**: even after the mask file is correctly regenerated, the runtime at `/` may keep showing the old shape. Two layers of caching are involved:
1. The browser's image cache, keyed by URL.
2. The in-process `useImageCache` Map (in `lib/canvas/useImageCache.ts`), also keyed by URL.

With a fixed URL like `/assets/base/main/mask_07.png`, both caches return the previously-loaded `Image` instance even after the file on disk has been rewritten. A hard reload usually clears the browser cache, but the React module-level Map can survive HMR in some configurations.

**Decision**: have `loadPartsForScene` attach a per-part `_rev` field — the same FNV-1a hash used by the regen sidecar — to each loaded part at runtime. `PartFinishLayer` appends `?v=<_rev>` to the mask + shading URLs it hands to `useImage`. When a polygon changes, `_rev` changes, the URL changes, both caches treat the new URL as a brand-new asset, the browser re-fetches.

**Per-part rather than global**: a polygon edit on ⑦ only invalidates `mask_07`/`shading_07`. The other 16 parts keep their cached images.

The `_rev` field is added to the runtime object **after** Zod parsing, so the on-disk schema is unchanged.

### D14. Click pass-through on the editing-part polygon Line

**Problem**: the editing-part polygon `<Line>` rendered with a 10%-opacity blue fill (visual reference for the polygon area) but no `listening={false}`. Konva routed clicks (and right-clicks) inside the polygon to the Line shape. The Stage's `onClick` handler then early-returned because `e.target !== stage`, so vertex add/insert never fired. Right-clicks on small vertex Circles that fell on the polygon's interior fill went to the Line instead of the Circle, so contextmenu didn't reach the Circle's `onContextMenu`.

**Decision**: mark the editing-part polygon `<Line>` `listening={false}`. The fill stays visible (Konva still renders it) but events pass through to the Stage. Vertex `<Circle>` handles remain interactive (default `listening={true}`) so they continue to receive context-menu and drag events.

### D15. Header layout never shifts during status transitions

**Problem**: the regen badge text "マスク更新済み <N>件 HH:MM:SS — メイン画面はリロードで反映" wrapped to a second line in the header, growing the header height and pushing the canvas down — disrupting fine vertex placement.

**Decision**: render the save badge + regen badge in a fixed-width column (200 px) with `whitespace-nowrap`. Shorten the regen done text to "マスク更新 <N>件 HH:MM:SS"; the longer "メイン画面はリロードで反映" reminder lives in the badge's `title` attribute (browser tooltip on hover). Header height is now constant across all save/regen state transitions.
