## Why

Customers need to visualize how specific building materials and fixtures (doors, flooring, cabinetry, etc.) look on a real base perspective (room) image before committing to a selection. Existing tools in this space (e.g. Woodone's "ラクラクプレゼン") rely on pre-rendered variation images that explode combinatorially and cannot support true free-color simulation, and are built on unmaintainable legacy stacks (Angular 6, Shift_JIS, Flex-era XML). We want a modern, greenfield application that lets a user (1) pick a base perspective image, (2) choose materials along the catalog axes (series / design / color / size / …), and (3) see the selection composited onto the image — with the door open for arbitrary-color simulation via mask composition rather than pre-rendering every color.

## What Changes

- Stand up a greenfield Next.js (App Router, TypeScript, UTF-8) application for the presenter.
- Introduce a **presentation canvas** powered by Konva that renders a user-chosen base perspective image and lets the user drop materials onto it.
- Introduce a **material catalog** with multi-axis filtering (series / design / color / width / height / …) backed by a local JSON catalog for the MVP.
- Introduce a **color composition** layer that composites `base.jpg + mask_<part>.png + shading_<part>.png` on Konva so any HEX color can be applied to a part region on the base image, preserving lighting/shading. CSS `filter: hue-rotate` is explicitly NOT used.
- Introduce **project export**: render the current canvas to a PNG download via Konva's `toDataURL` / `toBlob`.
- Use **Zustand** for app state (selected base image, placed materials, per-part color overrides, selection state).
- Ship a minimal seed catalog and a single sample base image + mask/shading set so the MVP is demonstrable end to end.

Explicit non-goals for this MVP (deferred to later changes):
- **No frontend/backend separation.** The MVP is delivered as a single Next.js application with no dedicated backend service, no API server, and no database. Catalog and assets are static files under `public/`; export is client-side. This is a deliberate choice — see design.md D10 for the rationale and the explicit triggers (persistence, high-res PDF, real catalog, auth) that will drive a future separation. Absence of a `backend/` folder is intentional, not an oversight.
- No server-side persistence, auth, or multi-user support.
- No server-side PDF/2840×2000 print rendering.
- No rich editor affordances (text, shapes, lines, undo/redo, align, rotate, copy/paste, zoom, layer order).
- No CMS / admin UI for catalog management.
- No full pre-rendered variation library — MVP only demonstrates the mask pipeline + a handful of catalog entries.

## Capabilities

### New Capabilities
- `material-catalog`: Multi-axis browseable catalog of building materials and fixtures (series, design, color, width, height, opening type, mirror, type), backed by a static JSON dataset with thumbnails for the MVP.
- `presentation-canvas`: Konva-based interactive canvas that loads a user-selected base perspective image as its bottom layer and lets the user place, select, move, and delete material items on top of it.
- `color-composition`: Per-part color simulator that composites `base` + `mask` + `shading` layers on the canvas so an arbitrary HEX color can be applied to a specified region of the base image while preserving the original lighting.
- `project-export`: Export the current canvas state as a PNG image download.

### Modified Capabilities
<!-- None — this change bootstraps the project. -->

## Impact

- **New codebase**: Greenfield Next.js 14+ (App Router) + TypeScript project at the repo root.
- **New dependencies**: `next`, `react`, `react-dom`, `konva`, `react-konva`, `zustand`, `zod` (catalog schema validation), `tailwindcss` for styling.
- **New asset conventions**: `public/catalog/*.json` for catalog data; `public/assets/base/<scene>/{base.jpg,mask_<part>.png,shading_<part>.png}` for color-composition scenes; `public/assets/materials/<id>/<variant>.png` for material thumbnails and placement images.
- **No backend, no frontend/backend split**: MVP is fully delivered by a single Next.js app reading JSON from `public/` at runtime. No database, no separate API service, no Route Handlers added in this change. This is a recorded design decision (design.md D10), not a deferred chore — separation will be triggered by specific future needs (persistence / high-res PDF / real catalog / auth) and re-evaluated at that point.
- **Encoding**: UTF-8 everywhere (no Shift_JIS legacy carried over).
- **Out-of-scope risk**: Printing, server rendering, and full catalog ingestion are deferred; downstream changes will need to extend `project-export` and introduce a catalog ingestion capability.
