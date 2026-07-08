## Context

A scene (`public/assets/base/<scene-id>/`) owns one `parts.json` and a set of switchable base perspective images called **variants** (`scene.json` `variants`: e.g. `natural` / `flat` / `sharp`). Switching a variant swaps only the base image; the parts (geometry, marker, mask) are loaded once per scene and shared across all variants.

Finish options already vary per variant via `textureUrlByVariant`, `colorHexByVariant`, and `defaultForVariants` (`lib/finishes/schema.ts`, resolved in `components/parts/PartFinishLayer.tsx`). The one asset that does **not** vary is the part `mask`: `part.mask` is a single filename resolved relative to the scene directory (`resolveAssetUrl` in `lib/parts/load.ts`), so the same mask clips every variant. Because each variant is a different perspective, the same part occupies a different region per variant, and a shared mask cannot land correctly on all of them.

The mask PNG is rasterized from `part.polygons` (`lib/dev/regenAssets.ts`, triggered by `/api/dev/parts/regen`). Those same `polygons` also drive hit-testing and marker placement (`numbered-part-overlay`). The `/dev/trace` tool is the authoring surface for polygons.

## Goals / Non-Goals

**Goals:**
- Let a part present a different masked region per variant, following the existing `…ByVariant` pattern.
- Auto-generate each variant's mask PNG from per-variant polygons via the existing regen pipeline.
- Author per-variant mask polygons in `/dev/trace`, tracing against the correct base image.
- Preserve full backward compatibility: parts without per-variant data behave exactly as today.
- Let an individual finish option override the clip mask for its part via an optional `mask` (a pre-existing PNG loaded as-is), taking precedence over the part's base/per-variant masks; options without it are unaffected. Runtime mask compositing is complete with `mask` alone — no per-option geometry is stored.

**Non-Goals:**
- Per-variant hit-testing or per-variant `marker`. Clicking uses the single shared `polygons`/`marker`; perspective-induced click drift is accepted.
- Per-variant `shading`. Shading stays a single base asset.
- Changing the variant registry or composite layer ordering. (The finish-option schema *is* extended with an optional `mask` — see D6.)
- Storing per-option geometry, regenerating per-option mask PNGs, authoring option-level masks in `/dev/trace`, or load-time probing of `option.mask`. The option `mask` names a pre-existing file the runtime loads as-is; runtime compositing needs nothing more than that PNG.

## Decisions

### D1. Two new optional fields on the part schema, not a restructure
Add `maskByVariant?: Record<variantKey, filename>` (consumed by render + probe) and `maskPolygonsByVariant?: Record<variantKey, Polygon[]>` (consumed by regen). Both optional; absence ⇒ today's behavior.

- *Why two fields, not one keyed object?* It mirrors the codebase's split between an authored geometry source (`polygons`) and a resolved asset filename (`mask`), and keeps render-time resolution a cheap string lookup with no polygon data shipped to the client beyond what already ships.
- *Why not derive the filename instead of storing `maskByVariant`?* The existing pipeline stores explicit mask filenames and **probes** them at load (`load.ts:100`). Storing explicit filenames keeps that validation path uniform and lets regen and runtime agree on names without a shared derivation rule. Regen will *write* `mask_<id>__<variantKey>.png` by convention, but the manifest remains the source of truth.
- *Alternative considered — per-variant `polygons` that also drive hit-test:* rejected. The user explicitly scoped hit-test/marker as variant-invariant; coupling them would force per-variant markers and a much larger `/dev/trace` change.

### D2. Resolution precedence: active variant entry → base
Runtime (`PartFinishLayer`) resolves `part.maskByVariant?.[activeVariantKey] ?? part.mask`; regen resolves `maskPolygonsByVariant?.[key] ?? polygons`. This is the same precedence shape already used for `textureUrlByVariant` (`PartFinishLayer.tsx:53-62`), so the mental model is consistent. No active variant (no `variantsEnabled`, or scene without variants) ⇒ base mask.

### D3. Validation cross-checks variant keys against the scene
`maskByVariant` / `maskPolygonsByVariant` keys must exist in the scene's `scene.json` `variants`. This cross-scene check happens in the loader (where the scene is available), paralleling `crossValidateColorHexByVariantAgainstScene` in `lib/finishes/load.ts`. The part `partSchema` (Zod) validates shape; the loader validates keys + probes files.

### D4. Hash / cache-bust includes the new fields
The regen sidecar hash and the runtime `_rev` both fold in `maskByVariant` + `maskPolygonsByVariant` (stringified). Since per-variant mask filenames already differ, switching variants naturally requests a different URL; the `_rev` ensures a regen after an edit invalidates the cache. One sidecar hash per part still covers all of that part's masks (base + variants); a part is regenerated as a unit.

### D5. `/dev/trace` adds a variant selector that swaps the base image
The editor gains a variant picker. Picking a variant (a) swaps the displayed base image to that variant's `baseImageUrl` and (b) edits `maskPolygonsByVariant[key]`, seeding from the shared `polygons` on first touch. A "base/default" selection keeps editing the shared `polygons`. The marker and hit-test polygons are never mutated by variant editing. The side panel indicates the active editing target and offers "remove this variant's override".

### D6. Per-option mask override outranks part / per-variant masks
A finish-option entry may carry a single optional `mask` (a full web-root path string). No per-option geometry is stored — runtime mask compositing is complete with the PNG alone, so `polygons`-style source data is intentionally not part of this field set. When the selected option declares `mask`, `PartFinishLayer` composites that mask for the part **regardless of the active variant**. The full mask precedence becomes:

```
option.mask ?? part.maskByVariant?.[activeVariantKey] ?? part.mask
```

- *Why option wins over the per-variant mask, on every variant?* Per the user's scope, an option-level mask is an explicit, option-specific clip (e.g. アーバンシー ⑭ `ブラック2` carves a smaller hardware region than the part's shared sharp mask). It is authoritative for that option; re-resolving it per variant would defeat the override. The same option's `defaultForVariants`/`textureUrlByVariant` still drive the painted texture — only the clip mask is forced.
- *Why `mask` only, no geometry?* The runtime mask path is just "load PNG → `destination-in`"; it never consumes polygons. Polygons would only matter for regenerating or authoring the PNG, which this change does not do — the `mask` names a pre-existing file (e.g. an existing `mask_14__sharp.png` or a hand-authored PNG). Keeping the field set to `mask` alone keeps the schema minimal and the data file free of unused geometry.
- *Path handling.* `option.mask` is stored as a full path from the web root (`/assets/...`) and used directly, unlike `part.mask` (a scene-relative filename passed through `resolveAssetUrl`). This keeps option masks independent of any single scene's asset directory, mirroring how option `textureUrl` is a full path.
- *Cache-bust.* The option mask URL is busted on the catalog revision (`?v=<optionsRev>`), the same revision already used for `textureUrl`, not on the part `_rev`.
- *No load-time probe.* The loader does not HEAD-probe `option.mask` (mirroring `textureUrl`, which is also not probed). A missing file surfaces as a runtime image-load miss, not a load-time hard error.
- *Schema independence.* `mask` is optional and orthogonal to the `colorHex` / `textureUrl` xor; an option may declare a mask in either render mode.

### D7. `mask: "no"` sentinel disables mask compositing (texture mode only)
The `mask` field reserves the literal value `"no"` to mean "do not composite a mask at all." When the selected option declares `mask: "no"` **and the part's `renderMode` is `"texture"`**, `PartFinishLayer` resolves `maskUrl` to `null` and omits the trailing `destination-in` image, so the texture PNG is painted as-is (at its `textureBox` if present, else full-scene). The full mask precedence becomes:

```
option.mask === "no" (texture mode)  → no mask (paint texture unclipped)
option.mask (other string)           → use as full web-root path
part.maskByVariant?.[activeVariantKey]
part.mask
```

- *Why a sentinel string, not a new boolean field?* The decision is mutually exclusive with naming a mask path — an option either clips against some PNG or it doesn't. Folding it into the existing `mask` field keeps the catalog shape flat and the precedence linear. `"no"` stays a valid `z.string().min(1)`, so the schema is unchanged; only the runtime gives it meaning.
- *Why texture-only?* The intent ("指定PNGを表示する") is to show a pre-shaped texture PNG without clipping. A `renderMode: "color"` option paints a full-scene color rect that *relies* on the mask's `destination-in` to carve it down to the part region; dropping the mask there would tint the whole canvas. So in color mode `"no"` is ignored and the part mask resolves normally — the sentinel never produces a full-scene color flood.
- *No probe / no geometry.* Like a path-valued `mask`, `"no"` stores no geometry and is not probed at load; it is purely a runtime compositing switch.

### D8. Per-part default selection via a new `default-options.json` catalog, scoped per sheet and per base
A new optional catalog file `public/catalog/default-options.json` declares, **per sheet (brand)** and per part, the option that part starts pre-selected with — with an optional **per-base (per-variant)** refinement. The file is organized sheet-first:

```json
{
  "version": 1,
  "sheet": [
    {
      "id": "アーバンシー",
      "parts": [
        { "id": "03", "default": "03-urb-0-2" },
        { "id": "14", "default": "14-urb-0-opt0", "sharp": "14-urb-syn-ブラック" }
      ]
    }
  ]
}
```

Each part entry carries a required `default` (the fallback option id) plus any number of optional **base keys** (each equal to a scene `variant` key, e.g. `sharp`) mapping to an option id for when that base is active. The effective default for `(part, sheet, activeBase)` is `byBase[activeBase] ?? default` — when the active base has its own entry it wins, otherwise `default` applies. Sheets with variants disabled, or no active base, always resolve to `default`.

The runtime normalizes this into `PartSheetDefaults = Record<PartId, Record<SheetName, { default: FinishOptionId; byBase: Record<BaseKey, FinishOptionId> }>>` (here `{ "14": { "アーバンシー": { default: "14-urb-0-opt0", byBase: { sharp: "14-urb-syn-ブラック" } } } }`). A shared helper `resolveSheetDefault(entry, activeBase)` returns `entry ? (activeBase && entry.byBase[activeBase]) ?? entry.default : undefined`, so panel, seed, and sheet/base-switch lookups stay a cheap `resolveSheetDefault(partSheetDefaults[partId]?.[sheet], activeVariantKey)`. A part listed under the active sheet begins **selected** (not 未選択) with that sheet's effective default; a part not listed begins 未選択, exactly as today. The clear ("クリア") button shows **only when the current selection differs from the effective default**, and pressing it resets the selection to that effective default (it never returns a defaulted part to 未選択). For parts with no default, クリア still removes the selection as before.

- *Why per-base on top of per-sheet?* A part can look right with one option on most bases but need a different option on a skewed base (e.g. アーバンシー ⑭ defaults to `14-urb-0-opt0` but should start on `14-urb-syn-ブラック` when the `sharp` base is active). `default` covers the common case; the per-base keys override only where needed, with `default` as the universal fallback so partial base coverage is fine.
- *Why per-sheet (sheet-first file, one `default` per part within each sheet block), not a single global default per part?* Selections persist across sheet (brand) switches, and every option id belongs to exactly one sheet. A single default id would be meaningless on any other sheet. Per the user's decision ("シート毎に default を定義"), each `(sheet, part)` gets its own default so a defaulted part is correctly pre-selected on whichever brand is active. The sheet-first layout groups all of a brand's part defaults together, which mirrors how the workbook itself is organized by sheet.
- *Why a separate catalog file, not a field on `finish-options.json`?* The default is a *project/presentation* policy (which option to show first), not an attribute of an individual option. Keeping it in its own small file leaves the seed-generated `finish-options.json` untouched and lets the default set be hand-edited without risk of being overwritten by `seed:parts`. It mirrors how `sheets.json` is a separate, optional, hand-editable catalog.
- *Relation to `defaultForVariants`.* `defaultForVariants` answers "for a given variant, which option's texture is painted before any manual pick" (a render-time default within an option). `default-options.json` answers "which option is the selected one when the panel first opens" (a selection-state default for the whole part on a sheet/base). They are orthogonal: the seeded selection drives `partFinishSelections`, the swatch highlight, the クリア button, and the Excel export row, none of which `defaultForVariants` touches. The per-base key here resembles `defaultForVariants` in spirit but lives at the selection-state layer, not the texture-paint layer.
- *Loading & validation.* `loadDefaultOptions("/catalog/default-options.json")` parses the sheet-first file (part entry = `{ id, default }` plus a `catchall(z.string().min(1))` for base keys), flattens it to `PartSheetDefaults` separating `default` from the catchall base keys, and returns `{}` on 404 (optional, back-compat). A duplicate `(sheet.id, part.id)` pair is rejected at load. The loader then cross-validates **both `default` and every base override** of each `(sheet, part)` against the finish-options catalog: the option id MUST exist, its `partId` MUST equal the entry's part `id`, its `sheet` MUST equal the block's `sheet.id`, and its shape MUST match the part's `renderMode`. A mismatch throws a `FinishesLoadError` naming the part id, sheet, base key (when the offender is a base override), and option id — the same hard-fail discipline as the other catalog cross-validators.
- *State seeding.* `loadScene` receives the `partSheetDefaults` map, resolves the initial active base, and seeds `partFinishSelections[partId] = resolveSheetDefault(defaults[partId][defaultSheet], initialBase)` for every part that has a default for the initial sheet; other parts stay unselected. The map is held on the store so the panel and sheet/base-switch logic can resolve "the effective default" cheaply.
- *Sheet-switch behavior (extends "Selection preservation across sheet switch").* On switch, the new active base is resolved first, then classify each part by whether the user has made an **explicit** pick — `selection exists AND selection !== old (sheet, old base) effective default`:
  - *Explicit pick* → preserve by `(partId, label)` on the new sheet (today's rule); if no label match, fall to the new sheet's effective default (resolved with the new base) if one exists, else clear and include in the notification.
  - *At-default or untouched* (selection equals the old effective default, or no selection) → adopt the new sheet's effective default if one exists, else stay unselected.
  This keeps a defaulted part from ever landing on 未選択 on a sheet for which it has a default, while still honoring an explicit user choice and still notifying only when a real (explicit) selection is genuinely lost.
- *Base-switch behavior (`setActiveVariantKey`).* Switching the active base within the same sheet re-resolves the effective default per part. For each part: `oldDefault = resolveSheetDefault(entry, oldBase)`, `newDefault = resolveSheetDefault(entry, newBase)`. A part that is **at-default or untouched** (`!selection || selection === oldDefault`) adopts `newDefault` (if any); an **explicit** pick (`selection && selection !== oldDefault`) is preserved unchanged (same sheet ⇒ same option set, no label re-match needed). No notification is emitted — a base switch never loses an explicit selection. When no part has a per-base default, this loop is a no-op and base switching behaves exactly as today.
- *Clear action.* The panel computes `defaultId = resolveSheetDefault(partSheetDefaults[part.id]?.[activeSheet], activeVariantKey)`. Render クリア iff `currentId && currentId !== defaultId`. On click, `defaultId ? setFinish(part.id, defaultId) : clearFinish(part.id)`.

## Risks / Trade-offs

- **Click vs. fill drift** → By design, hit-test stays on shared `polygons` while the fill follows per-variant masks, so on a heavily skewed variant the clickable region and the painted region diverge. Mitigation: accepted per scope; the marker still anchors a sensible centroid, and the side list always selects parts regardless of geometry.
- **Asset proliferation** → up to `1 + variants` mask PNGs per part. Mitigation: only parts that declare `maskPolygonsByVariant` get extra files; regen writes them on demand; filenames are conventional (`mask_<id>__<key>.png`).
- **Authoring complexity in `/dev/trace`** → variant switching adds editor state (which target is active, base-image swap). Mitigation: reuse the existing single-polygon editor; "base" selection is the current behavior unchanged, so the default path is untouched.
- **Forgotten regen for a new variant** → editing per-variant polygons but not regenerating would leave a missing `maskByVariant` file, which the loader probe turns into a hard error. Mitigation: the existing debounced auto-regen-after-save covers per-variant masks; the load-time probe surfaces any gap loudly rather than silently.
- **Partial per-variant coverage** → a part with `maskByVariant` for only some variants. Mitigation: explicit fallback to base `mask` for uncovered variants is specified and tested.
- **Default drift vs. catalog** → a `default-options.json` referencing an option id removed/renamed by a later `seed:parts` run would silently mis-seed. Mitigation: the load-time cross-validator hard-fails naming the part/sheet/option, so a stale default surfaces loudly rather than as a blank panel.
- **Partial per-sheet default coverage** → a part with a default for only some sheets. Mitigation: specified behavior is "default sheets pre-select, other sheets start unselected"; switching to a sheet without a default for that part leaves it unselected (and クリア behaves as the no-default case there).
- **Partial per-base default coverage** → a part with a base override for only some bases. Mitigation: `default` is the required universal fallback, so any base without its own override resolves cleanly to `default`; a base override never has to be exhaustive.
- **Explicit-vs-default classification on switch** → relies on comparing the current selection to the *old* sheet's default to decide whether a pick was explicit. Mitigation: the old default is resolvable from `partSheetDefaults[partId][oldSheet]`; when absent (no old default) any selection is treated as explicit, which is the safe choice (never silently discards a user pick).
