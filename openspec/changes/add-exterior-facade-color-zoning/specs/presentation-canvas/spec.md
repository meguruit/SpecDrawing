## MODIFIED Requirements

### Requirement: Base scene selection and loading

The canvas MUST load the active perspective from the `base-perspective-registry` capability. The interior presenter lives on its own route, reached from the application's mode-selection menu at `/`; the application root itself MUST NOT load a scene. On entering the interior presenter route, the registry's default scene MUST be loaded with no further user action; the loaded scene's `base.jpg` MUST become the bottom layer of the canvas, and the scene's parts MUST be exposed to the `numbered-part-overlay` and `color-composition` capabilities. The MVP's user-facing scene-picker UI is removed; the registry still supports multiple scenes for future expansion, but exactly one scene loads by default in this change.

#### Scenario: Default scene auto-loads

- **WHEN** the user enters the interior presenter route
- **THEN** the canvas renders the default registered perspective's `base.jpg` as its bottom layer and exposes its parts to the overlay and composition capabilities

#### Scenario: Scene missing required asset fails visibly

- **WHEN** the active scene's `base.jpg` or its referenced `parts.json` is missing or invalid
- **THEN** the loader surfaces an error naming the scene and the missing/invalid file, and does not leave the canvas in a half-loaded state

#### Scenario: Application root does not load a scene

- **WHEN** the user opens `/`
- **THEN** the mode-selection menu is shown and no scene, parts manifest, or finish catalog is requested

#### Scenario: Interior behaviour is otherwise unchanged by the route move

- **WHEN** the user enters the interior presenter route
- **THEN** part selection, the finish-options panel, the side list, the sheet switcher, the variant switcher, the marker toggle, and the export action all behave exactly as they did when the presenter was served at `/`

## ADDED Requirements

### Requirement: Interior canvas state is isolated from exterior mode

The interior canvas store MUST NOT carry exterior-mode concepts — projects, angles, zones, uploaded image references, or Jolypate colour selections. Entering the interior presenter route MUST NOT open the exterior workspace's browser-local database.

#### Scenario: No exterior fields on the interior store

- **WHEN** the interior canvas store is inspected
- **THEN** it has no project, angle, zone, uploaded-image, or Jolypate-colour fields

#### Scenario: Interior route opens no exterior storage

- **WHEN** the interior presenter route is loaded
- **THEN** no IndexedDB connection for exterior projects is opened
