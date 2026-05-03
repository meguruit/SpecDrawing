## ADDED Requirements

### Requirement: Texture-as-default on variant-enabled scenes
For any scene whose `scene.json` `variants` array is non-empty AND whose primary sheet has `variantsEnabled === true` (currently: scene `main` with sheet `アーバンシー`), every part in `parts.json` whose role is NOT "accent cloth" MUST declare `renderMode: "texture"`. Accent-cloth parts (kitchen accent cloth and storage accent cloth) MUST declare `renderMode: "color"` so the customer's chosen `colorHex` continues to drive their appearance.

The accent-cloth exemption SHALL be expressed as an explicit list of part ids enumerated in this scene's parts manifest; no new schema field is introduced. The accent-cloth parts on scene `main` SHALL be exactly:

- `"07"` — キッチンアクセントクロス (`category: "キッチン"`)
- `"16"` — 収納アクセントクロス (`category: "収納アクセント"`)

These two parts MUST remain `renderMode: "color"` with a declared `shading` filename. Every other part in scene `main`'s `parts.json` MUST be `renderMode: "texture"`.

#### Scenario: Non-accent part on variant-enabled scene declares texture mode
- **WHEN** scene `main` is loaded and `parts.json` is validated
- **THEN** every part not in the accent-cloth list has `renderMode: "texture"`

#### Scenario: Accent-cloth part remains color mode
- **WHEN** scene `main` is loaded and `parts.json` is validated
- **THEN** parts `"07"` (キッチンアクセントクロス) and `"16"` (収納アクセントクロス) have `renderMode: "color"` and a declared `shading` filename
- **AND** every other part has `renderMode: "texture"` and no `shading` field

#### Scenario: Mismatch between sheet variants flag and parts.json render modes
- **WHEN** scene `main`'s sheet has `variantsEnabled: true` AND a non-accent-cloth part declares `renderMode: "color"` in `parts.json`
- **THEN** the loader surfaces an error at load time naming the offending part id and the policy violation
