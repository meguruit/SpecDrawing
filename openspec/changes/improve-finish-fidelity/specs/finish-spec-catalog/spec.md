## ADDED Requirements

<!--
This change is a proposal-only scope memo. The placeholder below records
the modified-capability declaration; the concrete requirement text +
scenarios land in the follow-up change `add-per-option-finish-renders`
(Item 3 of proposal.md).
-->

### Requirement: Per-option custom finish texture (placeholder for follow-up)
Detailed requirement and scenarios to be authored in change `add-per-option-finish-renders`. Captures: a finish option MAY declare a `customTextureUrl` pointing at a designer-authored (or AI-generated) scene-resolution finish render specific to that one option, taking precedence over both workbook swatches and base-variant cuts. A new `seed:custom-textures` pipeline step scans `resources/finishes/<partId>/<optionId>.jpg`, mask-clips, and updates the option's `textureUrl` accordingly. Re-running `seed:parts` MUST preserve the `customTextureUrl` field for options that already have one.

#### Scenario: Placeholder — see follow-up change for full scenarios
- **WHEN** the follow-up change `add-per-option-finish-renders` is implemented
- **THEN** this placeholder requirement is replaced with concrete WHEN/THEN scenarios covering per-option overrides, pipeline precedence (custom > variant > workbook), and seed-script preservation
