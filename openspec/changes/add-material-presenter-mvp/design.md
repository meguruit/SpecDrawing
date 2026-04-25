## Context

The target user experience mirrors the information-gathering done on Woodone's `/pboard/` — a canvas onto which a user drops catalog materials to preview how a room looks. That reference implementation has two properties we deliberately keep and two we deliberately break from:

**Keep:**
- Canvas-based compositing of pre-rendered material images on top of a base perspective image (fastest path to photorealism).
- Catalog browsing by multi-axis filters (series / design / color / …) that exhaustively describe the product space.

**Break from:**
- The "render every combination ahead of time" strategy — it leads to tens of thousands of image files and makes arbitrary (user-chosen HEX) colors impossible. We replace it with a mask + shading composition pipeline for the color-mutable parts of the base image.
- The legacy stack (Angular 6, jQuery, CreateJS, Flex-era XML, Shift_JIS, PHP). We replace it wholesale with Next.js 14 + React + Konva + Zustand + TypeScript, UTF-8 only.

This MVP deliberately keeps the scope narrow: one canvas, one base image per project, a small seed catalog, and a single PNG export. Everything else (PDF export, server-side high-res rendering, undo/redo, multi-page boards, collaborative editing, persistence) is deferred to follow-up changes.

**Constraints**
- Single-developer greenfield project, so complexity must be paid for.
- All assets are static files in `public/` for the MVP — no backend, no auth, no database.
- Must run offline-capable from the Next.js dev server so iteration is fast.

## Goals / Non-Goals

**Goals:**
- Prove the Konva canvas + mask compositing pipeline end-to-end on one real base image with at least one color-mutable part.
- Establish a catalog JSON schema (and Zod validator) that can grow to a full multi-axis product space without schema churn.
- Establish an asset-layout convention (`base.jpg` + `mask_<part>.png` + `shading_<part>.png`) that future base scenes can follow as a drop-in contract.
- Ship a demo page that a stakeholder can drive: pick a base scene, pick a material, place it, change a part's color, export PNG.

**Non-Goals:**
- Server-side rendering for print (2840×2000 PDF). Deferred.
- Full editing (undo/redo, text, shapes, alignment, z-ordering controls, rotation, zoom). Deferred.
- User accounts, saved projects, sharing. Deferred.
- Ingesting the Woodone catalog or any real third-party catalog. Seed with a handful of fabricated entries.
- Mobile/touch optimization. Desktop-first.
- Localization beyond string externalization hygiene — Japanese-first UI copy is fine.

## Decisions

### D1. Next.js 14 (App Router) + TypeScript, not a plain Vite/React SPA
**Why:** App Router gives us file-based routing, static asset serving under `public/`, and a straightforward path to server-side features later (PDF export, catalog API, auth). We don't need SSR for the canvas page itself — it will be a client component — but having the scaffold means we don't re-platform when we later want `/api/export` or catalog DB lookups. TypeScript is non-negotiable for the catalog schema.
**Alternatives considered:** Vite + React SPA (lighter but forces a re-platform for server-side features); Remix (similar to Next but smaller ecosystem for our needs).

### D2. Konva (via react-konva), not Fabric.js or raw Canvas
**Why:** Konva has first-class TypeScript typings, a declarative React binding (`react-konva`) that fits our stack, a mature layer/group/transformer model, and built-in `toDataURL` export. Fabric.js is heavier, its TS types are weaker, and its React integration is third-party. Raw Canvas is too low-level for drag/select/transform work we'll want even in the MVP.
**Alternatives considered:** Fabric.js (rejected for TS + React fit); PixiJS (overkill — we don't need a WebGL scene graph for 2D static images); raw Canvas API (too much wheel-reinventing for selection/transform).

### D3. Zustand for state, not Redux Toolkit or React Context
**Why:** The state shape is small and flat — current base scene, list of placed material instances, per-part color overrides, selection. Zustand gives us a single store, selectors with shallow compare, and zero boilerplate. Redux Toolkit is overkill; Context causes unnecessary re-renders for canvas-heavy updates.
**Alternatives considered:** Redux Toolkit (too much boilerplate for this scope); Jotai (atoms are great but Zustand's single-store mental model is simpler here); React Context (re-render storms).

### D4. Color composition via Konva composite operations on a dedicated "color layer", not WebGL shaders
**Why:** For the MVP's recolor case, the math is: `output = base × (1 − maskAlpha) + (color × shading) × maskAlpha`. Konva `Image` nodes support `globalCompositeOperation` (`multiply`, `source-in`, `destination-over`) which is enough to express this with three stacked nodes inside a dedicated part-group. WebGL would be faster for many parts, but for one-to-a-handful of parts on a 1024-ish canvas it's unnecessary complexity and harder to debug. If the part count explodes later, swapping in a regl/Three.js renderer is a localized change behind the `color-composition` capability.
**Alternatives considered:** WebGL shader (rejected for MVP — more moving parts, harder to debug, no perf need); CSS `filter: hue-rotate` (rejected — changes hue only, destroys shading fidelity); pre-rendered per-color variants (rejected — that's the legacy approach we're explicitly replacing).

### D5. Catalog as a static JSON file validated by Zod, not a DB or CMS
**Why:** MVP only needs a handful of entries to demonstrate axis filtering. Ship them as `public/catalog/materials.json` loaded at runtime (no bundling cost) and validated against a Zod schema at load time so malformed data fails loudly. The schema becomes the migration target for a future DB.
**Alternatives considered:** SQLite + Prisma (premature — no multi-user need); Contentful/Sanity (cost + account friction for MVP); hard-coding TS objects (hurts the "swap catalog to demo other data" flow).

### D6. Asset convention: `public/assets/base/<scene>/` holds `base.jpg` + `mask_<part>.png` + `shading_<part>.png`
**Why:** Mirrors the pipeline described in the research doc. Enforcing the triplet at a known path means `color-composition` can load a scene by id without needing a manifest for each scene (though we'll still ship `scene.json` per scene for the part list and label names). A scene is valid iff the triplet exists for every declared part.
**Rejected:** A flat `assets/` with every image sibling (loses "one scene = one folder" clarity); a database of asset URLs (backend not in scope).

### D7. PNG export only, via Konva `stage.toDataURL({ pixelRatio: 2 })`
**Why:** Exercises the canvas state end-to-end and is enough to prove the pipeline. The `pixelRatio: 2` gives a retina-quality export without needing a separate offscreen-render pass. PDF / high-res 2840×2000 is a dedicated follow-up change (will introduce a server-side Puppeteer or Resvg path per the research doc's §C).

### D8. No routing beyond `/` for MVP
**Why:** One page: scene picker on the left, canvas in the middle, catalog + color picker on the right. Deep-links like Woodone's `?tateguId` / `?colorId` are a follow-up — easy to layer on top of the Zustand store via URL state, but unnecessary to prove the core loop.

### D9. Styling with Tailwind, not CSS Modules or styled-components
**Why:** Fastest path to a tidy UI without bikeshedding tokens. No runtime cost. Plays nicely with Next.js App Router out of the box.

### D10. Single-tier Next.js app for the MVP — no separate backend service
**Decision:** The MVP is delivered as a single Next.js application with **no separate backend service**. There is no dedicated API server (Node/Express, FastAPI, Go, etc.), no database, no auth service, and no separate deployment unit for backend logic. Everything the user interacts with — UI, catalog data, scene assets, canvas rendering, PNG export — is served from one Next.js process, with catalog and asset files sitting under `public/`. Frontend and backend are deliberately **not** split into independent codebases or services.

**Why this is safe for the MVP:**
- The MVP has zero state that needs to outlive the browser tab — no accounts, no saved projects, no shared resources.
- The catalog is small enough (handful of seed entries) to ship as a static JSON file. There is no query workload that justifies a database.
- Export is client-side via Konva `toDataURL`. We do not need a server-side renderer until we add high-resolution PDF (a later change).
- Carrying a separate backend would force us to design service boundaries, an API contract, deployment, and CORS/auth concerns before we have validated the canvas pipeline. That cost buys nothing the MVP needs.

**What this means in practice:**
- All "data" lives under `public/` as static JSON or images. The browser fetches them directly via relative URLs.
- We do **not** add Next.js Route Handlers (`app/api/*`) in this change unless one is incidentally needed for a specific browser API constraint. If one becomes necessary, it stays inside this same Next.js app.
- Server Components vs. Client Components is an internal Next.js distinction, not a frontend/backend split. The Konva canvas page is a Client Component; the rest of the shell can be Server Components if convenient. Both run inside the same deployable.

**When we will revisit (explicit triggers — none of these are MVP work):**
1. **Persistence**: as soon as users need to save and reload projects across sessions/devices, we introduce a real backend (likely a Route Handler + Postgres, or a dedicated service if the team decides to split).
2. **High-resolution print export**: when we need 2840×2000 PDF output, we add a server-side renderer (Puppeteer/Playwright or Resvg). Whether it lives inside Next.js Route Handlers or as a separate worker is a decision we make at that point — not now.
3. **Real catalog**: when the catalog grows past ~hundreds of entries, faceted search performance, or needs an admin/CMS path, the static JSON approach is replaced by a backing store. That triggers a separation review.
4. **Auth / multi-tenant**: the moment user accounts enter scope.

**Alternatives considered:**
- *Split frontend (Next.js) + backend (Express/Hono/Fastify) from day one.* Rejected: introduces an API contract, dual deployment, and CORS configuration before any of those costs are paid back. Premature for an MVP whose entire value is "prove the canvas pipeline works."
- *Backend-for-frontend (BFF) inside Next.js Route Handlers from day one.* Rejected for the MVP because there is no data the browser cannot fetch directly. We will use this pattern when the persistence trigger fires — it is the most likely first separation step.
- *Static export only (`next export`), no server at all.* Tempting, but locks us out of Route Handlers and Server Components later without re-platforming. Keeping the standard Next.js server runtime gives us a cheap on-ramp to the future backend without paying for it today.

**Documented trade-off:** This is a deliberate "no separation" choice for now, captured here so a future contributor does not interpret the absence of a backend folder as an oversight. The seam where separation will likely first occur is **persistence**, and the contract that will harden first is the **catalog schema** (already Zod-defined in D5) — that schema is the migration target.

## Risks / Trade-offs

- **[Risk]** Konva `globalCompositeOperation` behavior differs slightly across browsers for complex stacks → **Mitigation:** lock the composite stack to a small, tested set (`multiply` for shading over color, `source-in` for clipping to mask); add a visual regression test against Chromium as the reference before we widen browser support.
- **[Risk]** Loading raw PNG mask + shading files is memory-heavy for large canvases → **Mitigation:** keep base images ≤ 2000 px on the long edge in the MVP seed; document the budget; revisit with tiled loading if the catalog grows.
- **[Risk]** Catalog schema churn as we discover axes we missed → **Mitigation:** model axes as an open `Record<string, string>` with a typed "known axes" union; unknown axes are permitted and surface as generic filters in the UI. Keeps the schema additive-only.
- **[Trade-off]** No backend means zero persistence — a reload wipes the canvas. Acceptable for MVP; follow-up change adds `localStorage` and then a real store.
- **[Trade-off]** Konva is a 2D scene graph and won't scale to many hundreds of parts with per-pixel effects. Acceptable for MVP; `color-composition` capability is the seam where we'd swap in a WebGL renderer.
- **[Risk]** `react-konva` requires `'use client'` and its SSR story is awkward → **Mitigation:** isolate all Konva usage inside a single client component, load it via `next/dynamic({ ssr: false })` from the page, and keep the rest of the app SSR-clean.
- **[Risk]** Asset path convention breaks silently when a scene is missing a mask → **Mitigation:** `scene.json` manifest lists declared parts; loader validates every declared part has its mask + shading file and throws a visible error at scene load time.

## Migration Plan

Not applicable — this is a greenfield change with no existing users or code. Rollback is `git revert`.

## Open Questions

- Do we want WebP in addition to PNG/JPG for the asset pipeline? (Defer — decide when asset count grows; MVP uses JPG for base, PNG for mask/shading for lossless alpha.)
- Do we commit seed assets to the repo or pull from a separate asset bucket? (MVP commits a single small seed scene in-repo; flag to move to a bucket when it exceeds ~10 MB total.)
- Should material placement snap to a scene's declared "slots" (like the Woodone XML layout) or be free-drag? (MVP: free-drag. Slots are a later capability once scenes define them.)
