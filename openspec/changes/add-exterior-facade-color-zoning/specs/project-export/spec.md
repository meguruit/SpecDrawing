## MODIFIED Requirements

### Requirement: Download filename

The downloaded files' names MUST follow the pattern for the mode that produced them, using the local-time export timestamp at click time.

**Interior mode** — using the active scene id and the active variant key (or the literal `default` when no variant is active):

- PNG: `specdrawing-<sceneId>-<variantKey>-<YYYYMMDDHHmmss>.png`
- Excel: `specdrawing-<sceneId>-<variantKey>-<YYYYMMDDHHmmss>.xlsx`

**Exterior mode** — using a filesystem-safe slug of the project name and of the angle name:

- PNG: `specdrawing-ext-<projectSlug>-<angleSlug>-<YYYYMMDDHHmmss>.png`
- Excel: `specdrawing-ext-<projectSlug>-<YYYYMMDDHHmmss>.xlsx`

When more than one file is produced by a single click, every file in that batch MUST share the same `<YYYYMMDDHHmmss>` value so the set is identifiable as one export.

#### Scenario: Filename includes scene, variant, and timestamp

- **WHEN** the user exports while scene `main` is active with `activeVariantKey = "flat"` on 2026-05-01 at 14:30:22 local time
- **THEN** the downloaded files are `specdrawing-main-flat-20260501143022.png` and `specdrawing-main-flat-20260501143022.xlsx`

#### Scenario: Filename uses "default" when no variant active

- **WHEN** the user exports while `activeVariantKey === null`
- **THEN** the downloaded PNG is named `specdrawing-<sceneId>-default-<timestamp>.png`

#### Scenario: Exterior filename includes project and angle

- **WHEN** the user exports the angle `外観1` of the project `駒込駅前` on 2026-08-19 at 09:15:00 local time
- **THEN** the downloaded PNG is `specdrawing-ext-駒込駅前-外観1-20260819091500.png` and the Excel is `specdrawing-ext-駒込駅前-20260819091500.xlsx`

#### Scenario: Batch export shares one timestamp

- **WHEN** an exterior project with 2 angles is exported in one click
- **THEN** both PNGs and the Excel carry the same `<YYYYMMDDHHmmss>` value

## ADDED Requirements

### Requirement: Exterior PNG export

The exterior workspace SHALL provide a single export action that produces a PNG of the composited result — the uploaded white perspective with every zone's colour, opacity, and finish texture applied. The exported PNG MUST reflect exactly what is on screen at the moment of export, MUST use `pixelRatio: 2` against the stage, and MUST exclude all editing affordances (vertex handles, ring outlines, selection highlight).

#### Scenario: Exterior export matches on-screen state

- **WHEN** the active angle has 4 zones with assigned colours, one of them at opacity 0.6 and one with the finish texture enabled, and the user exports
- **THEN** the downloaded PNG shows all 4 zones with those exact colours, opacity, and texture over the uploaded perspective

#### Scenario: Exterior export excludes editing affordances

- **WHEN** a zone is selected with visible vertex handles at the moment of export
- **THEN** the downloaded PNG contains no handles, outlines, or selection highlight

#### Scenario: Exterior export with no zones

- **WHEN** the user exports an angle that has no zones
- **THEN** the downloaded PNG is the uploaded perspective at the export resolution

### Requirement: Exterior all-angle export

The exterior workspace SHALL offer exporting every angle of the active project in one action, producing one PNG per angle. Angles MUST be rendered and written sequentially rather than concurrently, so that memory use does not scale with the number of angles.

#### Scenario: One PNG per angle

- **WHEN** the project has 2 angles and the user chooses the all-angle export
- **THEN** 2 PNGs are downloaded, one per angle, each named with its own angle slug and the shared timestamp

#### Scenario: Non-active angles export their own zones

- **WHEN** angle 1 is active and angle 2 has 5 zones with assigned colours
- **THEN** the exported PNG for angle 2 shows those 5 zones composited, not angle 1's zones

### Requirement: Exterior Excel spec sheet

The exterior export SHALL produce a `.xlsx` workbook containing two worksheets: `塗り分け` and `その他外装`.

The `塗り分け` worksheet MUST contain one row per zone across all angles of the project, grouped by angle and ordered within each angle by stacking order. The header row MUST label columns in Japanese in this order: `アングル / ゾーン / 色番 / 色名 / カテゴリ / 不透明度 / 砂岩仕上げ / スウォッチ`. Each data row MUST contain:

- `アングル` — the angle's name
- `ゾーン` — the zone's label
- `色番` — the assigned Jolypate colour number, or empty when unassigned
- `色名` — the assigned colour's Japanese name, or empty when absent or unassigned
- `カテゴリ` — the assigned colour's category, or empty when unassigned
- `不透明度` — the zone's opacity as a number in the range 0 to 1
- `砂岩仕上げ` — `"有"` when the finish texture is enabled, `"無"` otherwise
- `スウォッチ` — the assigned colour's swatch embedded inline via `worksheet.addImage`, empty when unassigned

The `その他外装` worksheet MUST contain one row per other-exterior category that has non-empty prompt text, with the columns `カテゴリ / 指定内容 / 更新日時`.

#### Scenario: Zone rows cover every angle

- **WHEN** the project has angle `外観1` with 3 zones and angle `外観2` with 5 zones, and the user exports
- **THEN** the `塗り分け` worksheet has 8 data rows, grouped by angle and ordered within each angle by stacking order

#### Scenario: Unassigned zone still gets a row

- **WHEN** a zone has geometry but no assigned colour
- **THEN** its row is present with the angle, zone label, opacity, and finish-texture columns filled and the colour columns and swatch left empty

#### Scenario: Swatch is embedded inline

- **WHEN** a zone has an assigned colour
- **THEN** that row's `スウォッチ` cell contains an inline image of the colour's swatch embedded via `worksheet.addImage`, sized to the row height

#### Scenario: Only filled prompt categories are listed

- **WHEN** two of the seven other-exterior categories have text
- **THEN** the `その他外装` worksheet has exactly two data rows

### Requirement: Exterior export action availability

The exterior export action MUST be disabled when the active project has no angle with an uploaded image, and enabled otherwise. Clicking it while disabled MUST NOT produce any download.

#### Scenario: Disabled before any upload

- **WHEN** the user has created a project but uploaded no image
- **THEN** the export action is visibly disabled and triggers no download when clicked

#### Scenario: Enabled with an uploaded image and no zones

- **WHEN** the project has one uploaded image and no zones
- **THEN** the export action is enabled and clicking it downloads the PNG and the Excel

### Requirement: Interior export path is unaffected by exterior export

Adding exterior export MUST NOT change the interior export's behaviour, its worksheet name, its column set, its `選択状態` resolution, or its filename pattern.

#### Scenario: Interior workbook unchanged

- **WHEN** the user performs an interior export after exterior export exists
- **THEN** the workbook contains the single worksheet `選択部材` with its established columns and `選択状態` values, exactly as before
