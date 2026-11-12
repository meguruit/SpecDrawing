## ADDED Requirements

### Requirement: Polygon-editing interactions are provided by a mode-agnostic shared module

The polygon-editing interaction rules that `/dev/trace` established — the 12 px edge-midpoint insertion with perpendicular-foot placement, the vertex hit / right-click-delete / drag behaviour, the non-listening polygon fill, and the history semantics (depth ≥ 30, one entry per discrete action, a drag collapsed into one entry) — MUST be implemented in a shared module that `/dev/trace` consumes, rather than being implemented privately inside the `/dev/trace` component.

The shared module MUST be mode-agnostic: it MUST NOT reference `/api/dev/parts`, the `parts.json` manifest shape, the `localStorage` draft mirror, the mask/shading regeneration pipeline, or any browser-local database. Persistence and asset regeneration remain the responsibility of each consuming mode.

#### Scenario: Shared module carries no persistence

- **WHEN** the shared polygon-editing module is inspected
- **THEN** it references neither the development parts API, nor the `localStorage` draft, nor the regeneration pipeline, nor IndexedDB

#### Scenario: A shared change reaches both consumers

- **WHEN** the 12 px edge tolerance is changed in the shared module
- **THEN** both `/dev/trace` and the exterior zone editor observe the new tolerance with no further change

#### Scenario: Extraction preserves /dev/trace behaviour

- **WHEN** a designer edits a part in `/dev/trace` after the extraction — clicking near an edge, clicking far from any edge, right-clicking a vertex, dragging a vertex, and pressing `Cmd/Ctrl+Z` and `Cmd/Ctrl+Shift+Z`
- **THEN** each interaction behaves exactly as specified for `/dev/trace` before the extraction, including the multi-ring targeting rules and the per-part history checkpoints

### Requirement: The dev/preview gate is not weakened by sharing

Sharing the polygon-editing module with a production-reachable mode MUST NOT weaken the `/dev/trace` gate. `/api/dev/parts` and `/api/dev/parts/regen` MUST continue to respond `404` outside development and Vercel preview, and no edit operation on `/dev/trace` may succeed on the production deployment. The shared module itself is not gated, because it performs no persistence.

#### Scenario: Production still 404s the dev API

- **WHEN** the app runs with `VERCEL_ENV === "production"` and `/api/dev/parts` is requested via `GET` or `PUT` after the shared module exists
- **THEN** the response status is `404` and no file-system access occurs

#### Scenario: The shared module is reachable in production without the dev API

- **WHEN** a user authors polygons in the exterior zone editor on the production deployment
- **THEN** the editing interactions work and no request is issued to `/api/dev/parts` or `/api/dev/parts/regen`
