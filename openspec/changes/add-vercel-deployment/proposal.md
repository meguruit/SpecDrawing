## Why

The app today only runs on a developer's `npm run dev`. To get the customer real previews, designers shared review links, and a single canonical URL for every PR, we need a hosted environment. The earlier `/` discussion ruled out GitHub Pages because (a) Next.js Route Handlers don't survive `output: 'export'`, (b) `next/image` optimization is dropped, and (c) Git LFS pointers don't auto-resolve at request time. Vercel solves all three natively (Route Handlers run as serverless functions, image optimization works, and LFS can be enabled via a build-command override). It also gives **per-PR preview deployments** for free, which lets a designer iterate `/dev/trace` against a real shared URL without waiting on a manual deploy.

## What Changes

- **Add a Vercel project** linked to `github.com/tatoflam/SpecDrawing` (production branch = `main`; preview = every other branch + every PR).
- **Override the install / build command** so Git LFS is pulled before `next build`. Vercel's default `git clone` does NOT pull LFS objects — the natural-base JPG, mask PNGs, finish swatches, and base variant JPGs (~50 LFS objects, ~50 MB) would all serve as 134-byte pointer files unless we explicitly pull. Concretely: `git lfs install --force --skip-smudge && git lfs pull` runs before `npm install` (or as part of the install command).
- **Extend the `/dev/trace` gating** to allow the dev API and the `/dev/trace` route on **preview deployments** (where designers iterate) but block them on **production** (the customer-facing URL). The current gate is `NODE_ENV !== "development"` → 404; this change extends it to also accept `VERCEL_ENV === "preview"`. Production builds (`VERCEL_ENV === "production"`) keep returning 404 from `/api/dev/*` and the `/dev/trace` UI degrades to a placeholder.
- **Cache headers** for `public/` static assets: `Cache-Control: public, max-age=31536000, immutable` for `mask_*.png`, `shading_*.png`, `_v_*.png`, and finish PNGs. Safe because the runtime already cache-busts these via `?v=<rev>` (per-part `_rev` for masks/shading from `dev-trace-tool`, catalog `_rev` for textureUrls from `finish-spec-catalog`). The base JPG and the parts/finish JSON are kept on the default `must-revalidate` so a re-deploy invalidates them immediately.
- **Image optimization config**: `next.config.mjs` already sets `images.unoptimized = false` (default), so Vercel's image optimization picks up `next/image` usages in `FinishOptionPanel` and `ExtractorImportPanel` automatically. No code change needed; documented for clarity.
- **Domain**: ship on the default `*.vercel.app` subdomain initially (`spec-drawing.vercel.app` if available, else a fallback). Custom domain (`example.co.jp`) is a follow-up that needs DNS access from the customer.
- **Tier choice**: Vercel Hobby (free) for now. Stays free for non-commercial / personal use up to 100 GB-Hours / mo. If the customer wants a custom domain on a "commercial" project they push us to Pro ($20/user/mo). Document the tradeoff so the customer can choose.

Explicit non-goals:

- No CI other than Vercel's own preview deployments (no separate GitHub Actions added by this change).
- No environment variables / secrets management beyond what Vercel auto-provides — this app has no third-party API keys.
- No custom domain setup in this change (DNS handoff is a customer task).
- No analytics / telemetry beyond Vercel's built-in basic analytics (Pro feature; off by default on Hobby).
- No build-time pre-rendering changes (the page is already client-rendered behind `dynamic({ ssr: false })` for Konva — Vercel just serves the shell statically).
- No production caching for `parts.json` / `finish-options.json` beyond default — if a designer re-runs `seed:variants` and pushes, the production deploy must reflect the new content immediately.

## Capabilities

### New Capabilities
- `vercel-deployment`: project configuration, build command + LFS handling, environment gating across `production` / `preview` / `development`, cache headers, and the operational expectations (deploy on push to main, preview per PR).

### Modified Capabilities
- `dev-trace-tool`: the "Tool scope and gating" requirement extends so the dev API + `/dev/trace` route allow access on Vercel `preview` deployments in addition to local `development`. The production gate is unchanged (still 404).

## Impact

- **New code**:
  - `vercel.json` (build command override + cache headers).
  - Update `app/api/dev/parts/route.ts` and `app/api/dev/parts/regen/route.ts`: `devOnly()` helper accepts both `NODE_ENV === "development"` and `process.env.VERCEL_ENV === "preview"`.
  - `app/dev/trace/page.tsx` (or the inner `TraceTool.client.tsx`): show a "production では無効" placeholder when fetching `/api/dev/parts` returns 404 (it does today via the existing error path; just verify the message is clear).
  - `next.config.mjs`: add `headers()` config for the long-cache patterns OR use `vercel.json` (pick one — `vercel.json` is more visible operationally).
- **No new dependencies**.
- **Repo size**: Vercel pulls the full LFS tree on every build (~50 MB). Builds take ~2-5 min on Hobby; well within Vercel's 45-min build limit.
- **Cost**: Hobby free for the demo phase. Pro $20/user/mo if/when we attach a custom domain and the project is commercial. No per-request charges for static assets at our expected traffic.
- **Production cost of the dev API gate change**: the gating logic adds one env-var lookup per request — negligible. The actual API logic only runs on preview. Production traffic continues to see 404 for `/api/dev/*`.
- **Backward compat**: deploying to Vercel does not change anything about `npm run dev` locally — `NODE_ENV === "development"` continues to unlock everything. No breaking change for designers.
- **Spec relationship to `improve-finish-fidelity`**: independent. This change can ship before, after, or in parallel with the fidelity-improvement items.
