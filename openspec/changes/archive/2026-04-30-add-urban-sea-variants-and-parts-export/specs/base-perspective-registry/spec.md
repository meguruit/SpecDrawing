## MODIFIED Requirements

### Requirement: Variant base perspectives per scene
A registered scene MAY declare additional variant base perspectives that share the same dimensions and camera as the default base. Each variant SHALL be identified by a short string key (e.g. `natural`, `sharp`, `flat`) and stored at `public/assets/base/<scene-id>/base_<variant>.jpg`. Variants are designer-side inputs to the seed pipeline AND, when the scene's `scene.json` enumerates them in a `variants` array, runtime-loadable assets that the canvas can swap to in response to a sheet-driven variant switcher (see `presentation-canvas` and `finish-spec-catalog`).

The customer-facing source files for variants live under `resources/base/ベースパース_<variant>.jpg` and are LFS-tracked alongside the natural base.

A scene's `scene.json` MUST be valid against the following shape for the new field:

```
variants: Array<{
  key: string,        // e.g. "natural" | "flat" | "sharp"
  label: string,      // human-readable label shown in the variant switcher
  baseImageUrl: string // path under public/, e.g. "/assets/base/main/base_sharp.jpg"
}>
```

The `variants` array MAY be empty (a scene with no variants); when non-empty, exactly one entry's `key` MUST match the scene's default `baseImageUrl` so the switcher has a "current" state on first paint. Every entry's `baseImageUrl` MUST resolve to a file present under `public/`. Validation failure produces a loud, named error and blocks the canvas from rendering.

#### Scenario: Default variant continues to be the canvas backdrop on first paint
- **WHEN** the runtime loads scene `main`
- **THEN** `scene.json`'s `baseImageUrl` is the default variant (e.g. `base_natural.jpg`)
- **AND** other variants are NOT fetched until a variant switcher requests them

#### Scenario: Variants array exposes runtime-loadable images
- **WHEN** `scene.json` declares `variants: [{ key: "natural", ... }, { key: "flat", ... }, { key: "sharp", ... }]`
- **THEN** the loader exposes the array to consumers (`presentation-canvas`) so the variant switcher can fetch any entry's `baseImageUrl` on demand

#### Scenario: Variants array missing on a scene that does not need them
- **WHEN** a scene declares `variants: []` or omits the field entirely
- **THEN** the scene loads successfully and the runtime renders the default `baseImageUrl` with no variant-switcher data exposed

#### Scenario: Variant baseImageUrl missing on disk fails visibly
- **WHEN** `scene.json` lists a variant whose `baseImageUrl` does not exist under `public/`
- **THEN** the loader surfaces an error naming the scene id, the variant key, and the missing file, and the canvas does not render

#### Scenario: Variant key collision rejected
- **WHEN** the `variants` array contains two entries with the same `key`
- **THEN** validation fails at load time with an error naming the duplicated key

#### Scenario: Default variant key not present in variants array
- **WHEN** the `variants` array is non-empty AND no entry's `baseImageUrl` matches the scene's top-level `baseImageUrl`
- **THEN** validation fails at load time naming the scene id

#### Scenario: Variant absence does not break scene loading (legacy)
- **WHEN** a scene's `base_natural.jpg` is present but `base_sharp.jpg` is absent AND `scene.json` does NOT list `sharp` in `variants`
- **THEN** the scene loads successfully and the runtime renders the natural perspective
- **AND** the seed pipeline's variant cutter logs a `variant-missing` warning when an option references the missing variant
