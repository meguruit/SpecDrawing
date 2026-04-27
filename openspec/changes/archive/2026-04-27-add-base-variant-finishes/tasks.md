## 1. Asset rename + scene manifest update

- [x] 1.1 `git mv resources/base/ベースパース.jpg resources/base/ベースパース_natural.jpg`
- [x] 1.2 `git mv public/assets/base/main/base.jpg public/assets/base/main/base_natural.jpg`
- [x] 1.3 Update `public/assets/base/main/scene.json` `baseImageUrl` from `/assets/base/main/base.jpg` → `/assets/base/main/base_natural.jpg`
- [x] 1.4 Verify runtime still loads `/` with the renamed file (Playwright: `base_natural.jpg` fetched on mount, no errors)
- [x] 1.5 Extend `.gitattributes` to LFS-track `public/assets/base/main/base_*.jpg` so future variants land in LFS too

## 2. Override config + parts.json render-mode flip

- [x] 2.1 Create `resources/catalog/finish-base-overrides.json` with the 13 entries from the proposal table (① ⑤ ⑥ ⑧ ⑨ ⑫)
- [x] 2.2 Update `public/assets/base/main/parts.json`: ⑫ `renderMode: "color"` → `"texture"`; remove `shading: "shading_12.png"` field
- [x] 2.3 Update `lib/parts/types.ts` Zod schema: reject `shading` on texture-mode parts (additional `.refine` enforces `renderMode === "texture" → shading === undefined`)

## 3. Variant-cutting seed script

- [x] 3.1 Add `scripts/cut-base-variants.mjs`:
  - Read `resources/catalog/finish-base-overrides.json`, `public/catalog/finish-options.json`, `public/assets/base/main/parts.json`, `public/assets/base/main/scene.json`
  - For each override `(partId, optionLabel) → variant`:
    - Probe `resources/base/ベースパース_<variant>.jpg`. If missing → emit `variant-missing` warning, skip
    - Find every option matching `(partId, label)` across all sheets in `finish-options.json`. If none → emit `no-matching-option`, skip
    - Load variant base as raw RGB at scene resolution (resize-to-fit on dimension mismatch with a warning)
    - Load mask as raw alpha
    - Crop both to polygon bbox (with 8 px padding for Gaussian-feathered mask edges)
    - Compose RGBA = (variantRGB, maskAlpha) → write bbox-cropped PNG to **shared** path `public/assets/finishes/<partId>/_v_<variant>.png`
    - Set every matching option's `textureUrl` to the shared path and attach `textureBox: { x, y, width, height }`
- [x] 3.2 Write a single `public/catalog/finish-options.json` with the updated `textureUrl` + `textureBox` preserved across non-overridden options
- [x] 3.3 Append warnings to `public/catalog/finish-options.warnings.json` (alongside the existing `seed:parts` warnings) under a new `kind` namespace; replace pre-existing variant-cutter warnings on each rerun
- [x] 3.4 Wire `npm run seed:variants` in `package.json`

## 4. Runtime cache-bust + textureBox positioning

- [x] 4.1 In `lib/finishes/load.ts`, change `loadFinishOptions` to return `{ options, _rev }`; compute `_rev` as FNV-1a 32-bit hash of the raw JSON body
- [x] 4.2 In the canvas store, persist `finishOptionsRev: string` alongside `finishOptions`; `loadScene` action takes the rev as a 5th arg
- [x] 4.3 Extend `FinishOption` schema with optional `textureBox: { x, y, width, height }` (Zod `textureBoxSchema`)
- [x] 4.4 In `components/parts/PartFinishLayer.tsx`, append `?v=<finishOptionsRev>` to every `option.textureUrl`; if `option.textureBox` is set, paint the texture at `(textureBox.x, textureBox.y)` with `(width, height)` instead of full-scene
- [x] 4.5 Update `app/page.tsx` to pass the rev into the store via `loadScene`

## 5. Initial run + verification

- [x] 5.1 Run `npm run seed:parts` to refresh ⑫ option entries with `textureUrl` (after the `color` → `texture` flip)
- [x] 5.2 Run `npm run seed:variants` — wrote 13 shared (partId, variant) PNGs covering 26 option entries; **0 warnings** because the customer supplied all 3 variant base files (natural / sharp / flat)
- [x] 5.3 Verify cropped PNG sizes are tractable: each `_v_<variant>.png` is 50–500 KB (bbox-cropped); 13 files total ≈ 4 MB across all parts
- [x] 5.4 Browser smoke (Playwright on port 3001):
  - Load `/` → `base_natural.jpg` fetched (rename works)
  - Select ⑫ → ｸﾚﾏﾌﾞﾛｯｸ → URL `/assets/finishes/12/_v_flat.png?v=4gg92j` fetched (cache-bust applied); polygon outline visible at the entry-floor area on canvas
  - Select ⑤ → ブラック / ⑥ → ブラック / ① → ﾁｬｲﾅ大理石(黒) → all three sharp-variant cuts render (range hood goes black, hanging-shelf hardware goes black, kitchen counter goes black-marble)

## 6. Variant-missing fallback verification (deferred)

- [ ] 6.1 Skipped — customer supplied all 3 variant base files in this iteration. The fallback code path is in place but not exercised. (Will trip naturally if a future variant key is added to the override config without a corresponding base file.)

## 7. Docs + validation

- [x] 7.1 Update `resources/reference/AUTHORING.md`: variant base file naming, override config shape, `seed:variants` step, missing-variant fallback, render-mode considerations
- [x] 7.2 `npm run typecheck`, `npm run lint`, `openspec validate add-base-variant-finishes` all pass
- [x] 7.3 Update `README.md`'s "Run it" section to add `npm run seed:variants`
