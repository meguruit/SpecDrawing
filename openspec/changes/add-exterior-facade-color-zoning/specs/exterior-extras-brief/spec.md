## ADDED Requirements

### Requirement: Fixed categories for other exterior items

The workspace SHALL provide a free-text prompt field for each of a fixed set of other-exterior categories: `ライティング`, `アクセント`, `館銘サイン`, `ポスト`, `外構-緑化`, `外構-舗装`, and `門扉`. The category set MUST be fixed in this change; users MUST NOT be able to add or remove categories.

#### Scenario: All categories are offered

- **WHEN** the user opens the other-exterior panel
- **THEN** a prompt field is present for each of the seven categories

#### Scenario: Categories are not user-editable

- **WHEN** the other-exterior panel is open
- **THEN** no control exists to add, rename, or remove a category

### Requirement: Prompts are recorded, not rendered

Prompt text SHALL be recorded as project data only. This capability MUST NOT call any language model or image-generation service, MUST NOT add any server endpoint, and MUST NOT alter the rendered canvas in any way. The panel MUST display a persistent statement that the entered text is not reflected in the image and is recorded in the specification sheet.

#### Scenario: Entering a prompt does not change the canvas

- **WHEN** the user enters 「エントランス上部に間接照明、暖色 2700K」 in the `ライティング` field
- **THEN** the canvas rendering is byte-identical to before the text was entered

#### Scenario: No model or service is called

- **WHEN** the user enters and saves prompts in every category
- **THEN** no request is issued to any language-model or image-generation service, and no server endpoint is invoked

#### Scenario: The limitation is stated in the UI

- **WHEN** the other-exterior panel is open
- **THEN** a statement that the text is not reflected in the image and is recorded in the specification sheet is visible

### Requirement: Prompts are per project and persisted

Prompts SHALL be scoped to the project, not to an individual angle, and MUST be persisted with the project so that they survive a page reload. Each category's entry MUST record the time it was last modified.

#### Scenario: Prompts survive reload

- **WHEN** the user enters prompts in three categories, reloads the page, and reopens the project
- **THEN** all three prompts are present with their text unchanged

#### Scenario: Prompts are shared across angles

- **WHEN** the user enters a prompt while angle 1 is active and then switches to angle 2
- **THEN** the same prompt text is shown, because prompts belong to the project

#### Scenario: Modification time is recorded

- **WHEN** the user edits a category's prompt
- **THEN** that category's last-modified time is updated

### Requirement: Prompts appear in the exported specification

Recorded prompts SHALL be included in the exported specification sheet, one row per category that has non-empty text, carrying the category name, the prompt text, and the last-modified time. Categories left empty MUST be omitted from the export rather than exported as blank rows.

#### Scenario: Filled categories are exported

- **WHEN** the user has entered text for `ライティング` and `門扉` and exports the specification
- **THEN** the export contains exactly two other-exterior rows, one per filled category, each with its text and last-modified time

#### Scenario: Empty categories are omitted

- **WHEN** five of the seven categories are empty at export time
- **THEN** the export contains no rows for those five categories

#### Scenario: Prompts are included in the project JSON export

- **WHEN** the user exports the project as JSON
- **THEN** the file carries every non-empty prompt with its category and last-modified time
