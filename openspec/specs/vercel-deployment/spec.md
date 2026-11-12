# vercel-deployment Specification

## Purpose
Defines the project's hosting model on Vercel: how the GitHub repo is wired to a Vercel project, how Git LFS objects land in the build environment so binary assets serve as real bytes (not 134-byte pointers), how runtime cache headers are emitted for cache-busted assets and live manifests, how `next/image` optimization is preserved selectively, and which Vercel tier is required for the demo phase. The capability also frames the boundary with `dev-trace-tool` (preview deploys are read-only at the API layer).

## Requirements

### Requirement: Project hosted on Vercel
The project SHALL be deployable to Vercel as a single Next.js project linked to the GitHub repository `meguruit/SpecDrawing`. The production deployment MUST track the `main` branch (auto-deploy on every push). Preview deployments MUST be created automatically for every other branch push and every pull-request push.

#### Scenario: Push to main triggers production deploy
- **WHEN** a commit is pushed to the `main` branch on GitHub
- **THEN** Vercel starts a production deploy for that commit
- **AND** on success, the production URL serves the new build

#### Scenario: PR push triggers preview deploy
- **WHEN** a commit is pushed to a non-main branch that has an open PR
- **THEN** Vercel creates a preview deployment with a per-branch URL
- **AND** the URL is posted as a comment on the PR

### Requirement: LFS objects fetched at build time
Vercel's default git clone does not pull Git LFS objects. The project's install command SHALL be overridden so `git lfs install --force && git lfs pull` runs before `npm install`, ensuring every LFS-tracked file (base JPGs, mask PNGs, shading PNGs, finish PNGs, base-variant cuts) lands as actual binary content in the build environment instead of as a 134-byte pointer file. The build MUST fail if any expected LFS-tracked file is still a pointer at the end of the install step.

#### Scenario: LFS pull resolves the natural base JPG
- **WHEN** a Vercel build runs after a fresh repo clone
- **THEN** `public/assets/base/main/base_natural.jpg` on the build server is a real JPEG (the file's MIME identification reads as `image/jpeg`)
- **AND** the file size matches the LFS-tracked content size, not 134 bytes

#### Scenario: Build fails when LFS pull would have left a pointer
- **WHEN** the install command's smoke check (e.g. `file -b public/assets/base/main/base_natural.jpg | grep -q JPEG`) finds the file is not a JPEG
- **THEN** the install command exits non-zero
- **AND** Vercel marks the build as failed

### Requirement: Cache headers for cache-busted assets
Static assets that the runtime cache-busts via `?v=<rev>` query strings (per-part `_rev` for masks/shading; catalog `_rev` for option `textureUrl`s) MUST be served with `Cache-Control: public, max-age=31536000, immutable`. Manifests (`parts.json`, `finish-options.json`, `scenes.json`, `scene.json`) MUST be served with `Cache-Control: no-cache` so a re-deploy is reflected immediately at the next request.

The `vercel.json` `source` patterns MUST be valid path-to-regexp v6 (the resolver Vercel uses today) — unnamed regex groups like `(mask_|shading_|base_)` are rejected as `invalid-route-source-pattern` and break the deploy. Use named params (`:file`) or split into per-prefix rules.

#### Scenario: Mask PNGs are aggressively cached
- **WHEN** the browser requests `/assets/base/main/mask_07.png?v=anvtxo`
- **THEN** the response includes `Cache-Control: public, max-age=31536000, immutable`

#### Scenario: parts.json is not aggressively cached
- **WHEN** the browser requests `/assets/base/main/parts.json`
- **THEN** the response includes `Cache-Control: no-cache`

### Requirement: Image optimization remains enabled
`next/image` usages (e.g. option thumbnails in `FinishOptionPanel`, `ExtractorImportPanel`) MUST continue to be served through Vercel's built-in image optimization. The Konva-rendered images (mask, shading, texture) MUST NOT be routed through the image optimizer (they're loaded as plain `Image()` instances and need original pixels for destination-in composites).

#### Scenario: Option thumbnails go through the optimizer
- **WHEN** the browser requests an option thumbnail rendered by `next/image`
- **THEN** the URL is the Vercel-optimized path (`/_next/image?url=…`)

#### Scenario: Mask PNGs do not go through the optimizer
- **WHEN** the canvas requests `mask_07.png`
- **THEN** the URL is the raw `/assets/base/main/mask_07.png` (no `_next/image`)

### Requirement: Hobby tier is sufficient for the demo phase
The default Vercel Hobby (free) tier MUST be sufficient for the demo-phase deployment. A move to Pro is required only when the customer commits to a custom domain on a commercial project, wants Vercel Analytics, wants Password Protection on previews, or hits Hobby's 100 GB-Hours / mo serverless cap.

#### Scenario: Hobby covers the demo workload
- **WHEN** the demo runs at expected traffic (~ tens of customer / designer sessions per month)
- **THEN** monthly Vercel Hobby usage stays within the free tier limits (no overage charges)

### Requirement: Node.js major pinned to a supported LTS
The project SHALL declare a single Node.js major version that is an actively supported LTS line (not past its end-of-life date) and is selectable on Vercel. The `engines.node` field in `package.json` and the `.nvmrc` file MUST name the same major version, so local development and Vercel builds run on the same line. EOL majors (Node 20 and older) MUST NOT be declared.

#### Scenario: engines and .nvmrc agree on a supported major
- **WHEN** a reviewer reads `package.json` `engines.node` and `.nvmrc`
- **THEN** both resolve to the same Node.js major (e.g. `24.x` and `24`)
- **AND** that major is within its LTS support window on the review date

#### Scenario: EOL major is rejected
- **WHEN** a change would set `engines.node` or `.nvmrc` to Node 20 or an older major
- **THEN** the change MUST NOT be merged, because Vercel refuses new deployments on that major and it receives no security fixes

### Requirement: Deployments build and run on a patched Node.js runtime
Every Vercel deployment (preview and production) SHALL build and serve using the declared Node.js major, at a patch level that includes the most recent Node.js security release for that line. Because Vercel selects the patch automatically, the actual version MUST be verifiable from the build log or the runtime.

#### Scenario: Build log shows the patched version
- **WHEN** a preview or production deployment is built on Vercel
- **THEN** the build completes successfully (no Node-version deprecation error)
- **AND** the `node -v` reported in the build log is on the declared major and at or above the latest security patch for that line (for 24.x as of 2026-10-21: `v24.22.1`)

#### Scenario: Deployment on an unsupported major is detected before release
- **WHEN** a deployment fails because Vercel rejects the configured Node.js major
- **THEN** the failure is treated as a release blocker and the declared major is moved to a supported LTS line before re-deploying
