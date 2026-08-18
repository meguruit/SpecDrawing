## ADDED Requirements

### Requirement: Mode selection entry point

The application root `/` SHALL present a mode-selection menu with exactly two choices: 「内観パースイメージ作成」 and 「外観パース塗り分け」. Choosing 内観 MUST navigate to the interior presenter route; choosing 外観 MUST navigate to the exterior workspace route. The menu MUST NOT load any scene, parts manifest, finish catalog, or exterior project data — it is a routing page only.

#### Scenario: Menu offers both modes

- **WHEN** the user opens `/`
- **THEN** the page renders two selectable entries, 「内観パースイメージ作成」 and 「外観パース塗り分け」, and no canvas is rendered

#### Scenario: Selecting exterior mode

- **WHEN** the user selects 「外観パース塗り分け」
- **THEN** the browser navigates to the exterior workspace route and the exterior workspace mounts

#### Scenario: Menu performs no data loading

- **WHEN** `/` is rendered
- **THEN** no request is made for `scenes.json`, `parts.json`, or `finish-options.json`, and no IndexedDB transaction is opened

### Requirement: White-perspective image upload

The exterior workspace SHALL accept local image files (JPEG and PNG) via both a file-picker control and drag-and-drop onto the workspace. On accepting a file the system MUST decode it to read its intrinsic pixel dimensions, store the binary, and register it as an angle of the active project. Files that are neither JPEG nor PNG MUST be rejected with a message naming the file and its detected type, and MUST NOT be stored.

#### Scenario: Upload via file picker

- **WHEN** the user selects `駒込駅前_外観_1_20260807.jpg` through the file-picker control
- **THEN** the image is stored, registered as an angle of the active project, and displayed on the canvas at its stored pixel dimensions

#### Scenario: Upload via drag and drop

- **WHEN** the user drags an image file onto the workspace and drops it
- **THEN** the file is accepted identically to the file-picker path

#### Scenario: Unsupported file type is rejected

- **WHEN** the user drops a PDF file onto the workspace
- **THEN** the workspace surfaces an error naming the file and its type, stores nothing, and creates no angle

#### Scenario: Oversized image is downscaled on ingest

- **WHEN** the user uploads an image whose longest edge exceeds 4000 px
- **THEN** the image is downscaled so its longest edge is 4000 px before being stored, and the stored dimensions become the coordinate system for that angle's zones

### Requirement: Multiple angles per project

A project SHALL hold one or more angles, each backed by one uploaded image. Zones, colour assignments, opacity values, and the finish-texture flag MUST be stored **per angle** and MUST NOT leak between angles. The workspace MUST provide a control to switch the active angle, to rename an angle, and to delete an angle.

#### Scenario: Two angles hold independent zones

- **WHEN** the user uploads two exterior images to one project, draws 3 zones on angle 1 and 5 zones on angle 2
- **THEN** switching to angle 1 shows exactly its 3 zones and switching to angle 2 shows exactly its 5 zones

#### Scenario: Switching angle swaps the base image

- **WHEN** the user switches the active angle
- **THEN** the canvas base image becomes that angle's stored image and the zone list becomes that angle's zones

#### Scenario: Deleting an angle removes its zones

- **WHEN** the user deletes an angle that has zones
- **THEN** a confirmation is required, and on confirmation the angle, its zones, and its stored image binary are all removed

### Requirement: Browser-local persistence

All exterior project data — uploaded image binaries, angle definitions, zones, colour assignments, opacity values, finish-texture flags, and extras prompts — SHALL be persisted in IndexedDB in the user's browser. The system MUST NOT transmit any of this data to a server. Persistence MUST survive a page reload: reopening the exterior workspace MUST restore the last active project and angle with all zones intact.

#### Scenario: Reload restores work in progress

- **WHEN** the user draws 4 zones with colours assigned, then reloads the page and reopens the exterior workspace
- **THEN** the same project and angle are active with all 4 zones, their polygons, colours, opacity values, and finish-texture flags unchanged

#### Scenario: No network transmission of project data

- **WHEN** the user uploads an image, draws zones, and assigns colours
- **THEN** no request carrying the image binary or the project state is issued to any server endpoint

#### Scenario: Image binaries and edit state are stored separately

- **WHEN** the user drags a single zone vertex
- **THEN** the persisted write touches only the project record and does not rewrite the stored image binary

### Requirement: Multiple projects with explicit identity

The workspace SHALL support multiple named projects. Creating a project MUST require a project name. The workspace MUST list existing projects, allow switching between them, and allow deleting a project. Deleting a project MUST require confirmation and MUST remove that project's stored image binaries along with its record.

#### Scenario: Create and switch projects

- **WHEN** the user creates a project named `駒込駅前` and later creates a second project named `本郷三丁目`
- **THEN** both appear in the project list and switching between them swaps the angles, zones, and extras prompts shown

#### Scenario: Deleting a project reclaims its image storage

- **WHEN** the user deletes a project holding 2 uploaded images and confirms
- **THEN** the project record and both stored image binaries are removed from IndexedDB

### Requirement: Storage-usage visibility and local-only warning

The workspace MUST display a persistent notice stating that the data is stored only in this browser. The workspace MUST report the current storage usage, and when usage exceeds 80% of the browser-reported quota, it MUST surface a warning that names the projects consuming the most storage.

#### Scenario: Local-only notice is always visible

- **WHEN** the exterior workspace is open
- **THEN** a notice stating that the data lives only in this browser is visible without scrolling

#### Scenario: Quota pressure warns the user

- **WHEN** IndexedDB usage exceeds 80% of the reported quota
- **THEN** a warning is surfaced identifying the largest-consuming projects and offering project deletion

### Requirement: Project JSON export and import

The workspace SHALL export a project as a single JSON file containing every piece of project state **except** the image binaries — project name, angle definitions (original filename plus stored pixel dimensions), zones, colour assignments, opacity values, finish-texture flags, and extras prompts. The workspace SHALL import such a file, prompting the user to re-attach an image file per angle. An image whose pixel dimensions do not match the angle's recorded dimensions MUST be rejected with a message naming both dimensions, because zone coordinates are expressed in image pixel space.

#### Scenario: Export omits image binaries

- **WHEN** the user exports a project with two 4000×3637 images
- **THEN** the downloaded JSON contains both angles' filenames and dimensions but no image bytes

#### Scenario: Import with matching images restores the project

- **WHEN** the user imports a project JSON and attaches, for each angle, an image whose dimensions match the recorded dimensions
- **THEN** the project is created with all zones, colours, opacity values, finish-texture flags, and extras prompts restored, and the zones align with the images

#### Scenario: Import rejects a mismatched image

- **WHEN** the user attaches an image of 2000×1818 to an angle recorded as 4000×3637
- **THEN** the attachment is rejected with a message naming both dimension pairs, and the angle remains unattached

### Requirement: Client-only rendering boundary for the exterior canvas

All Konva rendering in the exterior workspace MUST live inside a client component loaded via `next/dynamic` with `ssr: false`. Server-rendered pages MUST NOT reference Konva symbols, and MUST NOT reference IndexedDB APIs at module scope.

#### Scenario: No SSR crash on exterior route

- **WHEN** the exterior workspace route is requested and rendered by the Next.js server
- **THEN** the response succeeds with no Konva-related and no IndexedDB-related import errors

### Requirement: Exterior state is held in a store separate from the interior canvas

Exterior workspace state MUST be held in its own Zustand store, distinct from the interior canvas store. The exterior store MUST NOT contain interior concepts (`activeScene`, `parts`, `finishOptions`, `partFinishSelections`, `activeVariantKey`), and the interior store MUST NOT contain exterior concepts (projects, angles, zones, uploaded image references).

#### Scenario: Stores do not share fields

- **WHEN** either store is inspected
- **THEN** the exterior store carries no interior scene/part/finish fields and the interior store carries no project/angle/zone fields

#### Scenario: Interior route does not mount exterior state

- **WHEN** the interior presenter route is loaded
- **THEN** no IndexedDB connection for exterior projects is opened
