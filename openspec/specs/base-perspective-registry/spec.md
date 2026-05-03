# base-perspective-registry Specification

## Purpose
TBD - created by archiving change redesign-numbered-part-finish-picker. Update Purpose after archive.
## Requirements
### Requirement: Registered base perspective images
The system SHALL maintain a registry of one or more base perspective images, each with a stable scene id, native pixel dimensions, the path to its `base.jpg`, and a reference to its numbered-part overlay manifest. The registry MUST be backed by a static JSON index at `public/assets/base/scenes.json` and per-scene `public/assets/base/<scene-id>/scene.json` manifests, both validated against a Zod schema at load time.

#### Scenario: Registry index is loaded and validated
- **WHEN** the app starts and `scenes.json` passes Zod validation
- **THEN** every registered scene id is available to the loader

#### Scenario: Invalid index blocks startup with a clear error
- **WHEN** `scenes.json` fails validation (e.g. an entry is missing `id` or `defaultPartsManifest`)
- **THEN** the app surfaces an error naming the failing entry and field, and does not render the canvas

### Requirement: Default perspective on app start
Exactly one entry in `scenes.json` MUST be marked as the default. On app start, the default perspective MUST be loaded into the canvas without further user action. The supplied `ベースパース.jpg` SHALL be the default perspective shipped with this change, registered under scene id `main`.

#### Scenario: Default perspective auto-loads
- **WHEN** the app starts with no prior session state
- **THEN** the canvas displays the default perspective's `base.jpg` as its bottom layer

#### Scenario: Exactly one default
- **WHEN** `scenes.json` contains zero or more than one entry with `default: true`
- **THEN** registry validation fails at load time with an error naming the violation

### Requirement: Per-scene asset probing at load
When a scene is loaded, the loader MUST probe its declared `base.jpg` and the numbered-part overlay it references. Any missing required asset MUST produce a loud, named error and MUST NOT leave the canvas in a half-loaded state.

#### Scenario: Missing base image fails visibly
- **WHEN** the active scene's `base.jpg` is absent
- **THEN** the loader surfaces an error naming the scene id and the missing file, and the canvas remains empty rather than partially rendered

#### Scenario: Scene successfully loads
- **WHEN** the active scene's `base.jpg` and parts manifest both resolve
- **THEN** the canvas renders the perspective and exposes the scene's parts to the `numbered-part-overlay` capability

### Requirement: Source vs. runtime asset separation
Designer-supplied source files (raw perspective JPGs, annotated reference PDFs, option workbooks) MUST live under `resources/{base,reference,catalog}/` and MUST NOT be served from `public/`. Runtime assets MUST live under `public/assets/base/<scene-id>/` and `public/catalog/`, and MUST be reproducible from the staged sources via a documented seed step.

#### Scenario: Sources are not exposed at runtime
- **WHEN** the Next.js server is running
- **THEN** files under `resources/` are not reachable via any served URL

#### Scenario: Runtime layout is reproducible from sources
- **WHEN** a contributor runs the documented seed step on a clean checkout containing `resources/base/<scene-id>/<source>.jpg`
- **THEN** the script produces (or refreshes) `public/assets/base/<scene-id>/base.jpg` and the corresponding scene manifest entry

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

