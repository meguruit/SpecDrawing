## ADDED Requirements

### Requirement: Variant base perspectives per scene
A registered scene MAY declare additional variant base perspectives that share the same dimensions and camera as the default base. Each variant SHALL be identified by a short string key (e.g. `natural`, `sharp`, `flat`) and stored at `public/assets/base/<scene-id>/base_<variant>.jpg`. The default variant remains the canvas backdrop loaded by the runtime; variants are designer-side inputs to the seed pipeline only and are NOT loaded directly by the runtime app.

The customer-facing source files for variants live under `resources/base/ベースパース_<variant>.jpg` and are LFS-tracked alongside the natural base.

#### Scenario: Default variant continues to be the canvas backdrop
- **WHEN** the runtime loads scene `main`
- **THEN** `scene.json`'s `baseImageUrl` is the default variant (e.g. `base_natural.jpg`)
- **AND** other variants on disk are not fetched by the runtime

#### Scenario: Variant absence does not break scene loading
- **WHEN** a scene's `base_natural.jpg` is present but `base_sharp.jpg` is absent
- **THEN** the scene loads successfully and the runtime renders the natural perspective
- **AND** the seed pipeline's variant cutter logs a `variant-missing` warning when an option references the missing variant
