## ADDED Requirements

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
