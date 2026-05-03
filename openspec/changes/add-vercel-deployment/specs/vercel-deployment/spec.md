## ADDED Requirements

### Requirement: Project hosted on Vercel
The project SHALL be deployable to Vercel as a single Next.js project linked to the GitHub repository `tatoflam/SpecDrawing`. The production deployment MUST track the `main` branch (auto-deploy on every push). Preview deployments MUST be created automatically for every other branch push and every pull-request push.

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
