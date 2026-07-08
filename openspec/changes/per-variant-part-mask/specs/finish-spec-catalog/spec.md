## MODIFIED Requirements

### Requirement: Finish-option entry shape
Each finish-option entry MUST have a globally unique `id`, a `partId` that resolves to a known part in the active scene's parts manifest, a `sheet` value identifying which workbook sheet it came from (e.g. `"アーバンシー"` or `"レコリード"`), a Japanese `label`, an optional `productCode`, an optional `subLabel`, a `thumbnailUrl` for the swatch image, an `iconUrl` for the Excel spec-sheet export, and a `defaultForVariants: VariantKey[]` array. Each entry MUST set exactly one of `colorHex` (when its part's `renderMode` is `"color"`) or `textureUrl` (when its part's `renderMode` is `"texture"`).

An entry MAY additionally declare a single optional `mask` that overrides the part-level mask for that option only. `mask` is a full web-root path (e.g. `/assets/base/main/mask_14__sharp.png`) to a pre-existing mask PNG. When present, the runtime composites the option against this mask in preference to the part's mask, independent of the active variant (precedence and path handling are defined by `color-composition`). The loader does NOT probe `mask` for existence (mirroring `textureUrl`). No per-option geometry is stored — runtime compositing needs only the PNG.

`mask` is optional and independent of the `colorHex` / `textureUrl` xor (an option may declare a mask in either render mode). An option without it resolves its mask entirely from the part, exactly as before.

The value `"no"` is a reserved sentinel: it does NOT name a file but instructs the runtime to disable mask compositing for that option (the runtime behavior is defined by `color-composition` "Per-option mask disable"). It remains a valid non-empty string, so the schema is unchanged; its meaning is given by the runtime only. The sentinel is honored for `renderMode: "texture"` options; for `renderMode: "color"` options it is ignored and the part mask resolves normally.

#### Scenario: Color-mode option requires colorHex
- **WHEN** an option's `partId` resolves to a part with `renderMode: "color"` and the option omits `colorHex`
- **THEN** validation fails at load time with an error naming the option id

#### Scenario: Texture-mode option requires textureUrl
- **WHEN** an option's `partId` resolves to a part with `renderMode: "texture"` and the option omits `textureUrl`
- **THEN** validation fails at load time with an error naming the option id

#### Scenario: Setting both colorHex and textureUrl is rejected
- **WHEN** an option declares both `colorHex` and `textureUrl`
- **THEN** validation fails at load time with an error naming the option id

#### Scenario: Duplicate option id rejected
- **WHEN** two options share the same `id`
- **THEN** validation fails at load time with an error naming the duplicated id

#### Scenario: defaultForVariants defaults to empty array
- **WHEN** an option entry omits the `defaultForVariants` field
- **THEN** the loaded option's `defaultForVariants` is the empty array `[]`

#### Scenario: Option-level mask is accepted
- **WHEN** an option declares `mask` (a non-empty path string)
- **THEN** validation passes and the loaded option carries `mask` verbatim

#### Scenario: Option without mask leaves the part mask authoritative
- **WHEN** an option omits `mask`
- **THEN** no option-level mask is recorded and the runtime resolves the part's mask from the parts manifest (per-variant → base)

#### Scenario: Reserved `mask: "no"` sentinel is accepted
- **WHEN** an option declares `mask: "no"`
- **THEN** validation passes and the loaded option carries `mask: "no"` verbatim (no file path is implied)

### Requirement: Selection preservation across sheet switch
When the active sheet changes, the system MUST first resolve the newly active base, then resolve each part's selection on the newly active sheet as follows, where a part's selection is **explicit** when it exists and differs from the part's **effective default** for the *previously* active sheet and base (per "Per-part default selection config"):

- An **explicit** selection MUST be preserved when an option with the same `(partId, label)` exists on the newly active sheet. If no such option exists, the selection MUST fall back to the part's effective default (resolved against the newly active base) for the newly active sheet when one is configured; otherwise it MUST be cleared.
- A non-explicit selection (one equal to the previous sheet/base effective default, or no selection at all) MUST adopt the newly active sheet's effective default when one is configured; otherwise the part MUST remain unselected.

The system MUST surface a non-blocking notification listing only the part ids whose **explicit** selections were cleared with no default fallback (parts that merely moved to a default are not listed).

When the active **base** changes within the same sheet, the system MUST re-resolve each part's effective default and adopt the new base's effective default for parts that are at-default or untouched, while preserving explicit selections unchanged; no notification is emitted for a base switch.

#### Scenario: Matching explicit selection is preserved
- **WHEN** the user has explicitly selected part `07` option `"サンドベージュ"` on `"アーバンシー"` and switches to `"レコリード"` where part `07` also has `"サンドベージュ"`
- **THEN** the selection on part `07` remains `"サンドベージュ"` and the finish layer for part `07` is unchanged

#### Scenario: Unmatched explicit selection falls back to the new sheet's default
- **WHEN** the user has an explicit selection on part `03` whose label exists only on `"アーバンシー"`, part `03` has a default configured for `"レコリード"`, and the user switches to `"レコリード"`
- **THEN** part `03`'s selection becomes the `"レコリード"` default and no clearing notification names part `03`

#### Scenario: Unmatched explicit selection with no default is cleared with notification
- **WHEN** the user has an explicit selection on part `15` whose label exists only on `"アーバンシー"`, part `15` has no default for `"レコリード"`, and the user switches to `"レコリード"`
- **THEN** part `15`'s selection is cleared, its finish layer is removed, and a notification names part `15` as cleared

#### Scenario: Defaulted part follows the active sheet's default
- **WHEN** part `03` is at its `"アーバンシー"` default and the user switches to `"レコリード"` where part `03` also has a default
- **THEN** part `03` adopts the `"レコリード"` default and no notification names part `03`

## ADDED Requirements

### Requirement: Per-part default selection config
The system SHALL support an optional catalog file at `public/catalog/default-options.json` that declares, per sheet and per part, the finish option a part starts pre-selected with, with an optional per-base (per-variant) refinement. The file is organized sheet-first with shape `{ version: 1, sheet: [{ id: SheetName, parts: [{ id: PartId, default: FinishOptionId, [baseKey: VariantKey]: FinishOptionId }] }] }`, where each block's `id` is a sheet (brand) name and each `parts[]` entry maps a two-digit part `id` to a required `default` option id plus any number of optional **base keys** (each equal to a scene `variant` key) that override the default when that base is active. The system MUST normalize this into a per-part per-sheet lookup whose value is `{ default, byBase }`. The file is OPTIONAL: when absent (HTTP 404), every part starts unselected exactly as before.

The **effective default** for a `(part, sheet)` under an active base MUST resolve to the base override when one exists for the active base, otherwise to the entry's `default`. When variants are disabled for the sheet or there is no active base, the effective default MUST be `default`. An entry with no base keys behaves exactly as a plain per-sheet default on every base.

At load time the system MUST reject a duplicate `(sheet.id, part.id)` pair, and MUST cross-validate every option id named by an entry — its `default` **and each base override** — against the finish-options catalog: the option id MUST exist, its `partId` MUST equal the entry's part `id`, its `sheet` MUST equal the block's `sheet.id`, and its `colorHex`/`textureUrl` shape MUST match the part's `renderMode`. On any mismatch the system MUST throw a visible error naming the part id, sheet, the offending base key (when the offender is a base override), and option id, and MUST NOT render a partial finish-options UI. Parts not listed under a sheet have no default for that sheet and start unselected.

#### Scenario: Defaults file is optional
- **WHEN** `default-options.json` is absent (404) at startup
- **THEN** the app loads normally and every part starts unselected (未選択)

#### Scenario: Defined part starts pre-selected on the active sheet
- **WHEN** `default-options.json` has a `"アーバンシー"` block listing part `03` with `default: "03-urb-0-2"` and the app starts with `"アーバンシー"` active
- **THEN** `partFinishSelections["03"]` is seeded to `"03-urb-0-2"` and part `03`'s finish layer renders that option without any user action

#### Scenario: Base override pre-selects a different option when its base is active
- **WHEN** part `14` declares `default: "14-urb-0-opt0"` and `"sharp": "14-urb-syn-ブラック"` on the active sheet and the active base is `sharp`
- **THEN** `partFinishSelections["14"]` is seeded to `"14-urb-syn-ブラック"`; and **WHEN** the active base is any base without its own entry **THEN** it resolves to `"14-urb-0-opt0"`

#### Scenario: Switching base re-seeds an at-default part
- **WHEN** part `14` is at its effective default and the user switches the active base to one with a different base override
- **THEN** part `14` adopts the new base's override option and no notification names part `14`; an explicit non-default selection on another part is preserved unchanged

#### Scenario: Undefined part is unaffected
- **WHEN** a part is not listed under the active sheet in `default-options.json`
- **THEN** that part starts unselected and its クリア behavior is unchanged (clearing removes the selection)

#### Scenario: Duplicate part within a sheet block blocks startup
- **WHEN** a sheet block lists the same part `id` twice
- **THEN** the app surfaces an error naming the duplicated `(sheet, part)` pair and does not render the finish-options panel

#### Scenario: Default or base override referencing an unknown or mismatched option blocks startup
- **WHEN** an entry's `default` or any base override names an option id that does not exist, belongs to a different part, belongs to a different sheet than the block's `sheet.id`, or mismatches the part's `renderMode`
- **THEN** the app surfaces an error naming the part id, sheet, base key (for a base override), and option id, and does not render the finish-options panel
