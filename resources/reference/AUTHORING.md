# Authoring Guide — Numbered Parts and Finish Images

This file documents how designers produce the runtime assets under `public/assets/base/<scene-id>/` and `public/assets/finishes/<part-id>/` from the source files staged in `resources/`.

## Source vs. runtime

```
resources/                                    designer source-of-truth (commit, do not serve)
  base/<scene-id>/<source>.jpg                raw perspective JPG (e.g. ベースパース.jpg)
  reference/部材対応番号-<n>.pdf               annotated reference PDFs (numbered parts ① – ⑰)
  catalog/部材リスト.xlsx                      option workbook (Git LFS)

public/                                       runtime, served by Next.js
  assets/base/<scene-id>/base.jpg             native-resolution copy of the source perspective
  assets/base/<scene-id>/scene.json           scene manifest (id, name, dimensions, partsManifestUrl)
  assets/base/<scene-id>/parts.json           numbered-part manifest (① – ⑰)
  assets/base/<scene-id>/mask_<NN>.png        alpha mask per part (scene-resolution)
  assets/base/<scene-id>/shading_<NN>.png     luminance map per color-mode part (scene-resolution)
  assets/finishes/<part-id>/<option-id>.png   per-option swatch (and texture, for texture-mode)
  catalog/scenes.json                         registry index
  catalog/finish-options.json                 generated from the workbook by `npm run seed:parts`
```

## Source perspective

- **File**: `resources/base/main/ベースパース.jpg` → copied at native resolution (no downscale) to `public/assets/base/main/base.jpg`.
- **Native dimensions**: 3000 × 2142 px (read from the source JPG; record in `scene.json`).
- **Camera / framing**: front-on view of the LDK from the living-room corner, kitchen island and back wall centered, sash on the left, entry on the right. All three reference PDFs are annotations on top of this same render.
- Do not re-render the perspective unless the underlying base render changes; if it does, re-trace polygons and re-author masks.

## Numbered parts

Every changeable surface is one of seventeen numbered parts (① – ⑰), enumerated in `部材リスト.xlsx`. The correspondence between number and on-image region is documented across three reference PDFs:

| PDF | Parts annotated |
| --- | --- |
| `部材対応番号-1.pdf` | ⑦ accent cloth (kitchen back wall), ⑨ spotlights/track, ⑩ entry door panel, ⑬ interior door panel |
| `部材対応番号-2.pdf` | ⑫ entry floor, ⑭ door hardware, ⑮ living-room floor, ⑯ accent storage cloth, ⑰ sash frame |
| `部材対応番号-3.pdf` | ① kitchen counter, ② indirect lighting, ③ gas stove, ④ kitchen panel, ⑤ range hood, ⑥ hanging-shelf hardware, ⑧ kitchen-base tile, ⑪ door hardware (kitchen side) |

For each part, author one record in `public/assets/base/main/parts.json`:

```jsonc
{
  "id": "07",                      // zero-padded; UI renders as ⑦
  "label": "キッチンアクセントクロス",
  "category": "キッチン",          // matches the workbook's leftmost category cell
  "sourcePdf": 1,                  // which 部材対応番号-N.pdf annotates it
  "marker": { "x": 1840, "y": 760 },// numbered-marker centroid in scene-pixel coords
  "polygon": [[1620, 600], …],     // ordered vertices of the colored outline on the PDF
  "renderMode": "color",           // see "Render mode" below
  "mask": "mask_07.png",
  "shading": "shading_07.png"      // required iff renderMode === "color"
}
```

### Polygon tracing

- Trace the colored outline shown on the reference PDF. Points are in **scene-pixel coordinates** of `base.jpg`, not PDF coordinates.
- 8 – 24 vertices is usually enough; precision matters more on edges that touch other parts.
- Use the dev-only tool at `/dev/trace` (added by task 3.6) to overlay a draft polygon on the base perspective and export vertices.

### Render mode

| `renderMode` | Use for | What you author |
| --- | --- | --- |
| `"color"` | flat colorways (paint, paper, fabric, sash frame) | a `mask_<NN>.png` and a `shading_<NN>.png` (luminance map). The runtime composites `shading × colorHex` clipped by the mask. |
| `"texture"` | material/grain swaps (door veneers, kitchen panels, fixture re-renders) | a `mask_<NN>.png` and one `<option-id>.png` per option in `public/assets/finishes/<part-id>/`, **rendered at scene resolution and lighting consistent with `base.jpg`**. The runtime overlays the texture clipped by the mask. |

Suggested defaults (revise as the catalog evolves):

| Part | Mode | Reason |
| ---- | ---- | ---- |
| ① キッチン天板 | texture | marble pattern, not a flat color |
| ② キッチン間接照明 | texture | fixture on/off + warm-light overlay |
| ③ ガスコンロ | texture | discrete fixture variants |
| ④ キッチンパネル | texture | distinct stone-print panels |
| ⑤ レンジフード | texture | fixture geometry / metal finish |
| ⑥ 吊り棚金具 | texture | hardware geometry |
| ⑦ キッチンアクセントクロス | color | flat wallpaper |
| ⑧ キッチン下タイル | texture | tile patterns |
| ⑨ スポットライト | texture | hardware finish + on/off variants |
| ⑩ ドアパネル | texture | wood-grain veneers |
| ⑪ ドア金具 | texture | hardware finish |
| ⑫ 床 (玄関) | color | flat tile colorway (most options) |
| ⑬ パネル ドレタス | texture | wood-grain veneers |
| ⑭ 金具 | texture | hardware finish |
| ⑮ 床 (LDK) | color | flat colorway (per option) |
| ⑯ 収納アクセントクロス | color | flat wallpaper |
| ⑰ サッシ枠 | color | sash paint colorway |

Override per part as needed; the seed script reads `renderMode` from `parts.json` and emits the appropriate option shape.

### Masks

- 8-bit alpha PNG, scene resolution (3000 × 2142 for `main`).
- Alpha = 255 inside the part region, 0 outside.
- Anti-alias the edges (a 1 – 2 px feather) so the composite doesn't show stair-step artifacts.

### Shading (color-mode only)

- 8-bit grayscale PNG, scene resolution.
- Reflect the part region's luminance from the base perspective: brighter where the base is brighter, darker where shadow falls.
- The shading value is multiplied against the chosen `colorHex`, so a uniform mid-gray map gives a flat result; the lighting cues come from the base render.
- Areas outside the part region don't matter (the mask clips them) — keep them mid-gray to avoid surprises if the mask changes.

## Texture-mode finish images

For texture-mode parts, every option in the workbook needs a pre-rendered finish image at scene resolution. Author them so that:

- The lighting matches `base.jpg` (re-render the same scene with the new material, do not slap on a flat texture).
- The image is full scene-size, even though only the masked region is shown — anything outside the mask is clipped and irrelevant.
- File path: `public/assets/finishes/<part-id>/<option-id>.png`.

The seed script (`scripts/extract-finish-options.mjs`) extracts the workbook's embedded swatch images to this same path so designers have a starting point — but the swatch is not the finish image. Replace the seed-emitted file with a scene-resolution render before shipping.

## Color extraction (color-mode only)

The seed script reads each option's swatch image from the workbook and computes a `colorHex` by averaging the central 50% of the swatch. Low-confidence extractions are listed in `public/catalog/finish-options.warnings.json`; override them by editing `resources/catalog/finish-overrides.json`:

```json
{
  "07-sand-beige": { "colorHex": "#D4BFA0" }
}
```

The seed script merges overrides on top of extractions when generating `finish-options.json`.

## Reproducing the runtime layout

```bash
git lfs install                           # one-time, per clone
npm install
npm run seed:parts                        # xlsx → finish-options.json + per-option PNGs
npm run seed:masks                        # parts.json polygons → mask + shading PNGs
npm run seed:variants                     # base variants → cropped per-(part, variant) textures
# parts.json polygons themselves are designer-authored via /dev/trace.
npm run dev
```

## Multi-variant base perspectives

Some finish options are not naturally expressible as a flat colorway or a
generic texture overlay (door panels, range hoods, ceiling-light fixtures,
entry-floor tiles). For these, the designer renders the same scene
multiple times with different material packs and the seed pipeline cuts
the relevant region out of the matching variant for each option.

**Files**

```
resources/base/
  ベースパース_natural.jpg     ← default canvas backdrop (always required)
  ベースパース_sharp.jpg       ← optional variant: black hardware pack, etc.
  ベースパース_flat.jpg        ← optional variant: flat tile pack, etc.
                              ← (you can add more variants by naming them
                                ベースパース_<key>.jpg and referencing
                                <key> from the override config)

public/assets/base/main/
  base_natural.jpg            ← runtime copy of the default; loaded by
                                scene.json's baseImageUrl

public/assets/finishes/<partId>/
  _v_<variant>.png            ← bbox-cropped piece of the variant base
                                clipped by the part's mask, generated by
                                npm run seed:variants
```

All variant base files MUST share the same dimensions and camera as the
default. The seed script `resize`s on dimension mismatch with a warning,
but a slight mismatch leads to bleeding edges in the cropped piece.

**Override config — when to add an entry**

`resources/catalog/finish-base-overrides.json` maps `(partId, optionLabel)`
to a variant key. **As of the variant-keyed workbook (2026-04-30), the
override config is only required for collapsed-label cases** — when the
same option label appears in MORE THAN ONE Natural / Flat / Sharp column.
Single-variant labels are auto-derived by `seed:variants` (no entry
needed).

Auto-derivation rule (in `cut-base-variants.mjs`):
- For every texture-mode option on a variant-enabled sheet, if
  `defaultForVariants.length === 1` AND the option has no manual
  override entry, the seed step automatically points the option's
  `textureUrl` at `_v_<defaultForVariants[0]>.png`.

When to add an override entry:
- The option's label appears in 2+ variant columns (collapsed). The
  manual entry tells the seed step which variant base to crop for the
  option's static `textureUrl` — this is the fallback used by the
  runtime when the active variant is NOT in the option's
  `defaultForVariants` set.

Example — current config (post-cleanup):

```json
{
  "version": 1,
  "overrides": {
    "01": { "ﾁｬｲﾅ大理石(白)": "natural" },     // 白 collapses [natural,flat]; on Sharp use natural cut
    "05": { "ブラック": "sharp" },              // ブラック collapses [flat,sharp]; on Natural use sharp cut
    "06": { "ブラック": "sharp" },
    "08": { "ｼｬﾝﾊﾟﾝﾎﾜｲﾄ": "natural" },        // collapses [natural,flat]; on Sharp use natural cut
    "09": { "ブラック": "sharp" }
  }
}
```

Notice that ⑫ has NO entry even though it has 3 distinct variant
labels — each label is single-variant (length 1) and auto-derived
from `defaultForVariants`. Same for ④, ⑩, ⑬, ⑮.

The same `(partId, optionLabel)` resolves to the same variant on every
sheet. Options without an entry AND with `defaultForVariants` length
zero (alternatives in column G+) keep their previous behavior
(workbook swatch).

**Runtime variant-following rule**: when an option has
`defaultForVariants` that includes the active variant key (e.g. ⑭
シルバー collapses across all 3 variants → defaults=[natural,flat,sharp]),
the canvas uses `option.textureUrlByVariant[activeVariantKey]` so the
part follows the active variant's base on every switch. Otherwise the
canvas uses the static `option.textureUrl` (set by override config or
auto-derive). This decouples "name = appearance" options (e.g. ﾁｬｲﾅ
大理石(黒) always paints the sharp-base black-marble crop) from
"variant-driven" options (e.g. ⑭ シルバー hardware naturally follows
the active room mood).

**Pipeline order**

1. `npm run seed:parts` — extracts options + workbook swatches.
2. `npm run seed:masks` — generates mask + shading PNGs from `parts.json`.
3. `npm run seed:variants` — overlays the per-(part, variant) cropped
   pieces on top of the workbook swatches for every override entry whose
   variant base file exists.

`seed:variants` MUST run last so it overwrites the workbook swatches set
by `seed:parts`. Each step is independently rerunnable: changing the
override config and re-running `seed:variants` updates only the affected
options without re-extracting the workbook or regenerating masks.

**Missing-variant fallback**

When a variant base file (e.g. `ベースパース_sharp.jpg`) is absent, the
seed step does not crash — it appends a `variant-missing` warning to
`public/catalog/finish-options.warnings.json` and leaves the affected
options' `textureUrl` at whatever `seed:parts` set (the workbook swatch).
The runtime continues to render the option using the swatch fallback. As
soon as the variant base is uploaded and `seed:variants` is rerun, the
swatch is replaced with the cropped piece.

**Render-mode considerations**

Variant cuts can only be served via `texture` mode (the runtime composites
the cropped image clipped by the mask). Parts whose options use variant
overrides MUST be `renderMode: "texture"` in `parts.json`. Color-mode
parts that need variant cuts must be flipped to texture (and the
`shading` field removed). Example: ⑫ 玄関床 was `color` in earlier
versions and is `texture` now to support its 3 variant options.

**Runtime variant switching (アーバンシー sheet)**

When a sheet declares `variantsEnabled: true` in
`public/catalog/sheets.json`, a runtime variant switcher (Natural / Flat /
Sharp) is shown next to the sheet selector. Switching the variant:

- swaps the canvas backdrop to the matching `base_<variant>.jpg`
  (declared in `scene.json`'s `variants` array),
- re-points every texture-mode part's `textureUrl` to
  `option.textureUrlByVariant[activeVariantKey]`,
- leaves color-mode parts unchanged (the customer's chosen color persists).

`seed:variants` populates `textureUrlByVariant` for every texture-mode
option on a variant-enabled sheet using one shared
`/assets/finishes/<partId>/_v_<variant>.png` per `(partId, variant)` pair.
A missing `base_<variant>.jpg` makes the seed step exit non-zero.

The accent-cloth carve-out (parts `"07"` キッチンアクセントクロス and
`"16"` 収納アクセントクロス) stays `renderMode: "color"` so the customer's
hex color continues to drive their appearance regardless of the active
variant.

## 部材リスト.xlsx — column conventions

The seed script `extract-finish-options.mjs` (`npm run seed:parts`) reads
`resources/catalog/部材リスト.xlsx` (canonical name; can be overridden
via `SPECDRAWING_WORKBOOK=<path> npm run seed:parts`) and emits:

- `public/catalog/finish-options.json` — every option keyed by
  `(partId, sheet)` with `id`, `label`, `subLabel?`, `productCode?`,
  `thumbnailUrl`, `iconUrl`, `defaultForVariants[]`, and either
  `colorHex` (color-mode) or `textureUrl` (texture-mode).
- `public/catalog/icons/<optionId>.png` — 96×96 icon embedded in the
  Excel spec-sheet export.
- `public/catalog/sheets.json` — sheet manifest.

The parser auto-detects the layout per sheet from row 0:

### Variant-keyed layout (current アーバンシー)

Row 0 contains the headers `Natural`, `Flat`, `Sharp` (case-insensitive,
in any columns):

```
A         B            C       D         E       F        G          H          ...
キッチン  画像対応番号  部材名  Natural   Flat    Sharp    [alt 1]    [alt 2]    ...
          ①           天板    白        白      黒
                              SP1234    SP1234  SP5678
          ②           照明    有        有      有       無
                              SP2001    SP2001  SP2001   光無し
```

For each part header row:
- The variant columns (D / E / F here) hold the per-variant defaults.
  Same-label cells across variants collapse into ONE emitted option
  whose `defaultForVariants` lists every matching variant key:
  `白 → ["natural", "flat"]`, `黒 → ["sharp"]`.
- Columns to the right of the rightmost detected variant column are
  alternatives — separate options with `defaultForVariants: []` that
  the customer can swap in.
- The next 4 rows are scanned for sub-row metadata. A cell matching
  `/^[A-Za-z0-9][A-Za-z0-9\s\-./]*$/` populates the option's
  `productCode`; any other non-empty Japanese cell becomes its
  `subLabel`.
- Embedded swatch images (anchored via `xl/drawings`) at the same
  column on row + 1 become the option's `thumbnailUrl` and `iconUrl`.
  When a collapsed option spans multiple columns, the leftmost source
  column's swatch wins; if it is missing, fall back to the next column.
  Variant-default labels for which the workbook does NOT supply a
  swatch (because the variant base itself shows them — e.g. ② 有 with
  no overlay needed) get gray placeholder thumbnails.

### Legacy layout (current レコリード)

Row 0 is missing one or more variant headers. Parser falls back to the
legacy "every column under a part header is a sequential option":

```
A         B            C       D         E       F        ...
キッチン  画像対応番号  部材名  [opt 1]   [opt 2] [opt 3]
```

Every emitted option has `defaultForVariants: []`. The legacy fallback
exists so sheets in transition coexist with already-migrated sheets.

### Variant override config

Per-option base-variant overrides live in
`resources/catalog/finish-base-overrides.json` and map
`(partId, optionLabel)` to a variant key. `seed:variants` cuts the
matching variant base at the part's mask region and rewrites the
option's `textureUrl` to the cropped piece. This lets a customer pick
"ﾁｬｲﾅ大理石(黒)" on the natural variant and still see black marble
(the override config maps `黒 → sharp`, and the sharp-base crop is
overlaid on the natural backdrop).

### Tint-base for alternative options

`finish-base-overrides.json` also accepts a `tintBase` block per part:

```json
"tintBase": {
  "10": { "label": "ｺｺﾅｯﾂﾁｪﾘｰ", "lift": 0.35 },
  "13": { "label": "ｸﾞﾚｰｼﾞｭ", "lift": 0.35 },
  "15": { "label": "ﾅﾗ樫", "lift": 0.15 },
  "17": { "lift": 0.5 }
}
```

`label` is **omitted** for color-mode parts (e.g. ⑰ サッシ枠). When
absent, the entry switches mode: `seed:variants` lifts the part's
`shading_<id>.png` file in-place using the same `Y' = Y + (255 - Y) * lift`
formula. This suppresses dark shading bands so `colorHex` values render
closer to their nominal hue (especially helpful for white/light hex
values that otherwise read as gray after the shading multiply). The
original shading is preserved as `shading_<id>.orig.png` so re-runs are
idempotent (never compound the lift).

When set, every alternative option (`defaultForVariants: []`) on that
part receives a per-variant **tinted** PNG: the named tint-base option's
masked variant base is converted to monotone luminance, then multiplied
by the alternative's icon color. The result preserves the wood-grain
detail from the base finish while shifting hue toward each option's
swatch. Output files: `<partId>/<optionId>__<variantKey>.png` × 3
(byte-identical across variants — kept three so each entry in
`textureUrlByVariant` has a unique URL for cache-bust).

`lift` (0..1, default 0) **suppresses the dark grain bands before the
multiply**. Pure multiply (`lift: 0`) crushes light icon colors —
white / ivory swatches collapse toward gray because the dark bands of
the wood grain dominate. The lift formula is `Y' = Y + (1 - Y) * lift`,
which pulls the luminance map toward white while preserving relative
contrast. Tuning notes:

- **Wood-grain doors / panels (⑩, ⑬)**: 0.5–0.6 keeps grain visible while
  letting light swatches read as light.
- **Floors (⑮)**: 0.1–0.2 — the floor grain is subtler and benefits from
  more contrast. Most floor alternatives are mid-tone, so the dark crush
  is less noticeable.
- **Sweep**: bump in 0.1 increments and re-run `npm run seed:variants`
  until the lightest icon-color alternative reads correctly.

The tint-base option MUST claim exactly one variant in its
`defaultForVariants` so the seed step knows which variant base to use as
the luminance source. If it claims multiple, the seed emits a
`tint-base-ambiguous-variant` warning and skips the part.

### Finish-variant-mapping config

`resources/catalog/finish-variant-mapping.json` is a designer-owned
override layer applied AFTER the workbook is parsed. It has three
independent blocks:

1. **`overrides`** — re-assign which option claims each
   `(partId, variantKey)`. Use this when the customer-prepared workbook
   has the wrong label in the Natural / Flat / Sharp column. Format:

   ```json
   "overrides": {
     "10": { "natural": "ｺｺﾅｯﾂﾁｪﾘｰ", "flat": "ﾀﾞｰｼﾞﾘﾝｳｫﾙﾅｯﾄ", "sharp": "ｴｽﾌﾟﾚｯｿｳｯﾄﾞ" }
   }
   ```

   Adds the variant to the named option's `defaultForVariants` and strips
   it from any prior claimant on the same `(partId, sheet)`.

   When the named label doesn't exist on the primary sheet (`アーバンシー`)
   but exists on a sibling sheet (e.g. `レコリード`), the seed step
   **synthesizes** a copy onto the primary sheet, preserving icon /
   product code / sub-label, and tags it `synthesized: true`. This is how
   ⑭ ブラック shows up on `アーバンシー` even though the workbook only lists
   it on `レコリード`.

2. **`noEffect`** — list of `(partId, optionLabel)` pairs that should
   render as an **ambient-fill** texture: the seed step samples the mean
   RGB of a 16-px ring just outside the part mask in each variant base
   and emits a solid-fill PNG. The part region visually erases by adopting
   its surroundings. Used for ② キッチン間接照明 *無* (turning off the
   lighting bloom). Format:

   ```json
   "noEffect": [
     { "partId": "02", "optionLabel": "無" }
   ]
   ```

3. **`colorHexByVariant`** — per-variant `#RRGGBB` overrides for
   color-mode options on a variant-enabled sheet. Materializes into
   `option.colorHexByVariant`. The runtime resolves
   `colorHexByVariant[activeVariantKey] ?? colorHex` so options can carry
   a per-variant palette while keeping the static `colorHex` as the
   fallback. Used for ⑰ サッシ枠 to harmonize the sash with each base
   perspective. Format:

   ```json
   "colorHexByVariant": {
     "17": {
       "カームブラック": { "natural": "#484d4a", "flat": "#484d4b", "sharp": "#494e4c" }
     }
   }
   ```

   To bootstrap a starter palette, run
   `node scripts/suggest-sash-palette.mjs [ringWidthPx] [blendWeight]` —
   it samples the mean wall color around ⑰ in each variant base and
   prints suggested per-variant hex values blended toward that wall.

### Auditing finish-options consistency

`node scripts/audit-finish-options.mjs [partIds...]` walks every option
on the primary sheet for the listed parts (default: `02 10 11 13 14 15
17`) and flags `(label, iconUrl, dominant texture color)` divergences.
Useful before a customer demo to catch workbook-level mistakes that the
override config didn't catch. The default distance threshold (80 in
sRGB) is tuned conservatively — a tinted-alternative texture will appear
darker than its icon (multiply blend), which the script flags but is
intended behavior for `tintBase` parts.

## /dev/trace workflow

The designer tool at <http://localhost:3000/dev/trace> edits
`public/assets/base/main/parts.json` directly through a dev-only API. Dev
server must be running.

**Editing**

- **Click empty canvas area** → append a vertex to the editing part's polygon.
- **Click within ~12 px of a polygon edge** → insert a vertex at the
  perpendicular foot on that edge (between its two endpoints).
- **Drag a vertex handle** → move it.
- **Right-click a vertex handle** → delete it.
- **Drag the numbered marker** → relocate the marker centroid.
- **Side panel "削除"** → delete a specific vertex by index.
- **Side panel "ポリゴンをクリア"** → clear all vertices for the editing part.
- **Header "部材" select** → switch the editing part (also a history checkpoint).

**Persistence**

- Every edit autosaves to disk after 600 ms via `/api/dev/parts` (PUT).
- Header badge shows `保存済み HH:MM:SS` on success.
- A localStorage mirror is updated on every keystroke; if the dev server is
  unreachable the badge says `ローカルに保持中（再送信を試行...）` and the tool
  retries every 2 s for up to 1 minute.
- On reload, if the localStorage draft is newer than the disk version, the
  side panel shows a "復元 / 破棄" prompt naming both timestamps.
- After a successful save, `parts.json.bak` holds the previous version
  (one-deep, gitignored).

**Undo / Redo**

- ⌘Z (or Ctrl+Z) undoes the last terminal mutation: vertex add, vertex
  delete, vertex drag-end, marker drag-end, polygon-clear, extractor-import,
  or part-switch.
- ⌘⇧Z (or Ctrl+Shift+Z) redoes.
- History depth is 30. Drag-move during a drag does **not** push history —
  only the drag-end does.

**Visibility toggle (header)**

- `他部材も表示` (default) — current behavior, faint dashed outlines for
  all other parts.
- `編集中のみ` — hide all non-editing outlines for a cleaner canvas.
- `最小表示` — also hide the editing part's marker (only the polygon).

The choice persists across sessions in localStorage.

**Importing extractor hints**

1. First run `node scripts/extract-pdf-polygons.mjs` to write
   `/tmp/parts-extracted.json` from the reference PDFs.
2. In `/dev/trace`, click `抽出結果を取込` in the header.
3. The panel lists all 17 parts with current vs. extracted polygon vertex
   count + bbox + marker coords. Tick "取込" per part for polygon and/or
   marker.
4. `選択をインポート` applies only the ticked items and pushes one undo
   entry per imported part.

**Manual download (fallback)**

`ダウンロード` in the header still emits a `parts.json` file the same way
as before. Use it if the dev API is unavailable for any reason.

**Editing on a Vercel preview deploy**

`/dev/trace` is reachable on every Vercel preview deployment (per branch
/ PR) for **reads only** — `GET /api/dev/parts` returns the deployed
`parts.json`, so designers can load and edit polygons against the same
hosted environment the customer will see. `PUT` and `POST` (autosave +
mask regen) return `503 preview-readonly` on Vercel because the
serverless runtime mounts the deployed app as a read-only filesystem
(only `/tmp` is writable, and even that is per-instance and ephemeral).

**The persistence path on preview is browser localStorage + manual
commit.** The autosave UI surfaces a terminal
`プレビューは保存不可 — ダウンロードしてコミット` status (no retry loop)
to steer designers to:

1. Make changes in `/dev/trace`; edits land in your browser's
   localStorage immediately (no disk roundtrip needed).
2. Click `ダウンロード` in the header to save the updated `parts.json`
   to your local machine.
3. Replace the repo's `public/assets/base/main/parts.json` with the
   downloaded file, commit to the branch, and push.
4. The next preview build serves the committed `parts.json`. If
   polygons changed, run `npm run seed:masks` locally first (mask regen
   also returns `503 preview-readonly` on Vercel) and commit the
   updated `mask_<NN>.png` / `shading_<NN>.png` files alongside.

Production deploys (`VERCEL_ENV === "production"`) hide the editor
entirely — `/api/dev/parts*` returns 404 and the `/dev/trace` UI shows a
placeholder ("本番環境では `/dev/trace` は無効です").

**Validation**

The dev API runs the request body through the same Zod schema the runtime
uses. A malformed manifest returns 422 with the failing field path; the
on-disk file is left untouched and the localStorage draft is preserved.

## Multi-ring polygons (`polygons` schema)

Each part's geometry is now a `polygons: Array<{ outer, holes? }>` field
instead of the single `polygon` field. Each entry is one disjoint region of
the part; `outer` is the region's outer ring and `holes` (optional) are
rings cut out of that outer.

Two authoring patterns this enables:

- **Multi-region parts** — e.g. ⑬ closet doors as two outer rings, one per
  door slab. The hit-test treats either region as a click on ⑬.
- **Holed parts** — e.g. ⑰ サッシ枠 as one outer rectangle (the frame's
  outer edge) with one hole rectangle (the glass). Clicks inside the hole
  fall through; clicks on the frame ring select ⑰.

### Migrating an existing `parts.json`

The repository keeps existing single-polygon parts working for one release
via a loader compatibility shim, but new authoring should use `polygons`.
Migrate in one shot:

```bash
npm run migrate:multiring   # rewrites parts.json: polygon → polygons[0].outer
npm run seed:masks          # regenerates every mask under the new sidecar hash
```

The migration is idempotent — re-running on an already-migrated file is a
no-op.

### Authoring sub-polygons and holes in `/dev/trace`

(UI shipping in this change; documented here for reference.)

- **`ポリゴンを追加`** appends a new `{ outer: [], holes: [] }` to the
  active part. The next canvas clicks build that entry's outer ring.
- **`穴を追加`** toggles hole-build mode under the active outer. The next
  click sequence builds a new hole; toggle off (or right-click `穴を完了`)
  to return to outer-edit.
- The side panel groups vertices by `polygons[i] / outer` and
  `polygons[i] / hole j`. Active sub-polygon and active hole are
  highlighted.

### Soft validation

- A hole MUST have ≥ 3 vertices (Zod-enforced; an in-progress hole with
  fewer triggers a 422 at autosave).
- The dev API also warns (non-blocking) when a hole's first vertex is
  geometrically outside its parent outer — likely an authoring mistake.
