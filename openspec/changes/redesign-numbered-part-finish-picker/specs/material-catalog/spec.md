## REMOVED Requirements

### Requirement: Catalog data source
**Reason**: Replaced by the `finish-spec-catalog` capability (`public/catalog/finish-options.json` derived from `部材リスト.xlsx`). The single-file `materials.json` model is no longer the data source.
**Migration**: Run `npm run seed:parts` to generate `public/catalog/finish-options.json` from the staged xlsx; remove `public/catalog/materials.json` from the repo.

### Requirement: Catalog entry shape
**Reason**: The generic axes model (`series` / `design` / `color` / `width` / `height` / `openingType` / `mirror` / `type` plus arbitrary unknown axes) does not match the actual customer workflow, in which a "choice" is a finish option scoped to a specific numbered part rather than a free-floating catalog entry. Replaced by the per-part option entry shape defined in `finish-spec-catalog`.
**Migration**: Drop the old entry shape and Zod schema. Per-part option entries are produced by the seed script and validated by the new schema in `lib/finishes/schema.ts`.

### Requirement: Multi-axis filtering
**Reason**: The new UI is "select a numbered part, then pick from its finite option list." There is no axis-filter UI in the redesigned flow.
**Migration**: Remove `lib/catalog/filter.ts` and `components/catalog/CatalogPanel.tsx`. Browsing happens via `numbered-part-overlay` (canvas markers + side list) and the per-part options panel from `presentation-canvas`.

### Requirement: Filtered result rendering
**Reason**: Same as above — there is no filtered-thumbnail grid. Selecting a part shows its option chips directly.
**Migration**: Replace the thumbnail grid with the per-part option chips rendered by the new `FinishOptionPanel` component (covered by `presentation-canvas`).

## ADDED Requirements

### Requirement: Per-part option lookup facade
The capability MUST expose a thin lookup function that, given the active scene, the active sheet, and a `partId`, returns the ordered list of finish-option entries for that part. The implementation MUST delegate to `finish-spec-catalog` and MUST NOT hold its own copy of the option data.

#### Scenario: Lookup returns options for a known part
- **WHEN** a caller requests options for `partId = "07"` on the active scene with sheet `"アーバンシー"`
- **THEN** the function returns every option whose `partId === "07"` and `sheet === "アーバンシー"`, in workbook order

#### Scenario: Lookup for unknown part returns empty
- **WHEN** a caller requests options for a `partId` not declared in the active scene's parts manifest
- **THEN** the function returns an empty array and does not throw

### Requirement: No standalone catalog UI
The capability MUST NOT render any standalone catalog browser, axis-filter sidebar, or thumbnail grid. All option rendering MUST happen through the per-part panel surfaces owned by `presentation-canvas`.

#### Scenario: No legacy catalog panel mounts
- **WHEN** the app is rendered
- **THEN** no component named `CatalogPanel` (or equivalent) is mounted in the DOM
