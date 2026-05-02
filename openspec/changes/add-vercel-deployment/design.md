## Context

The app is a single Next.js 14 App Router project. Notable runtime traits relevant to deployment:

- `/` is client-rendered (Konva loaded via `next/dynamic({ ssr: false })`).
- `/dev/trace` is a designer tool that talks to a dev-only API (`/api/dev/parts`, `/api/dev/parts/regen`) currently gated by `NODE_ENV === "development"`.
- All catalog data (parts.json, finish-options.json, scene.json) and visual assets (base JPGs, mask PNGs, shading PNGs, finish PNGs, base-variant cuts) live under `public/` and are served as static files.
- ~50 large binaries (base JPGs, finish PNGs, base-variant cuts) are tracked via Git LFS.
- The runtime aggressively cache-busts mask + texture URLs via `?v=<rev>` query strings, where `<rev>` derives from polygon content (per-part) and finish-options.json content (catalog-wide).

GitHub Pages was ruled out earlier (no Route Handlers, no LFS auto-resolution, no `next/image` optimization). This change picks Vercel.

## Goals / Non-Goals

**Goals:**
- One canonical production URL for the customer-facing demo, automatically updated on every push to `main`.
- A preview URL per PR / per non-main branch, available to designers and PMs without manual deploys.
- `/dev/trace` works against the preview environment so designers iterate against the same data the production demo will see.
- LFS-tracked assets resolve correctly at request time (no broken images).
- No design or runtime changes to the local `npm run dev` workflow.

**Non-Goals:**
- No custom domain in this change. (Customer needs to provide DNS; trivial to add later.)
- No CI other than Vercel's built-in deploy pipeline.
- No serverless function workloads beyond `/api/dev/*` (which only runs on preview / development).
- No HTTP auth on the production demo URL — the customer is fine sharing it openly. If that changes, add Vercel Password Protection (Pro feature) or basic auth via middleware in a follow-up.
- No analytics / telemetry beyond what Vercel ships by default.

## Decisions

### D1. Vercel over GitHub Pages, Cloudflare Pages, Netlify, self-host

| Option | Why not |
| --- | --- |
| GitHub Pages | No Route Handlers (would block dev API even on preview). No LFS resolution. `next/image` doesn't optimize. |
| Cloudflare Pages | Comparable to Vercel; chose Vercel for its tighter Next.js integration (App Router primitives, image optimization, preview deployments) and lower friction for first deploy. Cloudflare is a fine alternative if the customer later prefers it. |
| Netlify | Same shape as Vercel. Vercel chosen because it's the Next.js publisher's own host and has the most current support for App Router features. |
| Self-host (Render / Fly / EC2) | Higher operational overhead (we'd own the runtime, certs, log aggregation, etc.) for no functional gain at this scale. |

### D2. LFS at build time

Vercel's default git clone does NOT pull LFS objects (it stores LFS pointers — 134-byte text files referencing the LFS storage URL). If we don't override the build, every mask PNG / base JPG / finish PNG / variant cut returns those 134-byte pointers and the runtime sees broken images.

**Decision**: override the install command in `vercel.json` so it pulls LFS before installing dependencies.

```json
{
  "installCommand": "git lfs install --force && git lfs pull && npm install"
}
```

`--force` is needed because Vercel's git config sets `filter.lfs.smudge = git-lfs smudge --skip ...` which short-circuits the smudge filter; `--force` re-installs the standard LFS hooks. `git lfs pull` then fetches every LFS object referenced by the current commit.

**Cost**: ~50 MB pull on every cold build. Vercel's Hobby tier allows it; warm builds (cached `node_modules`) reuse the LFS objects already on disk and skip the re-pull. Total build time ~2-5 min cold, ~1-2 min warm.

**Alternatives considered:**
- Use `git lfs fetch --all` (pulls every version, not just current) — wasteful; no value.
- Pre-bake assets into a separate CDN bucket — overkill for current volume; revisit if assets grow > 500 MB.

### D3. `/dev/trace` gating model: production blocked, preview allowed

Today's gate in `app/api/dev/parts/route.ts`:

```ts
function devOnly() {
  if (process.env.NODE_ENV !== "development") return new NextResponse(null, { status: 404 });
  return null;
}
```

On Vercel, `NODE_ENV === "production"` for both production deploys and preview deploys. The distinguishing variable is `process.env.VERCEL_ENV`, which is `"production"` for the prod deploy, `"preview"` for branch / PR deploys, and `"development"` for local Vercel CLI runs.

**Decision**: extend `devOnly()` so the dev API + `/dev/trace` UI work on preview deployments but stay 404 on production.

```ts
function devOnly(): NextResponse | null {
  const isLocalDev = process.env.NODE_ENV === "development";
  const isVercelPreview = process.env.VERCEL_ENV === "preview";
  if (!isLocalDev && !isVercelPreview) return new NextResponse(null, { status: 404 });
  return null;
}
```

**Why this split**: designers need `/dev/trace` against a hosted environment so they can iterate against the same `parts.json` the customer sees in the next demo. The customer-facing production URL stays clean (no editor surface, no risk of accidental edits via the API). Per-PR preview deploys give each in-flight change its own designer playground.

**Risk**: a curious user who learns the preview URL pattern could trigger writes to `parts.json` on a preview environment. Mitigation: preview deploys are URL-scoped (`spec-drawing-git-<branch>-<account>.vercel.app`), not indexable by search engines (Vercel sets `X-Robots-Tag: noindex` on previews automatically), and writes are blocked at the API layer (see correction below). If we need stronger isolation later, gate `/dev/trace` behind Vercel Password Protection (Pro feature).

> **Correction (post-implementation)**: Vercel's serverless runtime mounts
> the deployed app under `/var/task` as a **read-only filesystem**; only
> `/tmp` is writable, and even `/tmp` is per-instance and ephemeral across
> requests. The earlier "edits land on the preview's serverless filesystem"
> assumption was wrong — `writeFile` under `public/` fails with `EROFS`.
>
> The implementation therefore returns `503 { error: "preview-readonly" }`
> from `PUT /api/dev/parts` and `POST /api/dev/parts/regen` whenever
> `process.env.VERCEL === "1"` (covers preview and would-be production,
> though production is already 404 from `devOnly()`). The `/dev/trace`
> client treats this as a terminal save status and steers the designer to
> the "ダウンロード → commit" workflow without retry-looping.
>
> Net effect: GET still works on preview (read-only access to the bundled
> `parts.json` is fine), so designers can load + edit + download, but
> preview writes never persist. Local `npm run dev` is unaffected.

### D4. Cache strategy

The runtime cache-busts mask and texture URLs via `?v=<rev>` on every load. The query is tied to the underlying file's content via FNV-1a hash. So the same URL with the same `?v=` always returns the same bytes — perfect for `Cache-Control: public, max-age=31536000, immutable`.

**Decision**: emit aggressive caching for the patterns the runtime cache-busts:

```jsonc
{
  "headers": [
    {
      "source": "/assets/base/main/(mask_|shading_|base_).*\\.(png|jpg)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
    },
    {
      "source": "/assets/finishes/(.*)\\.png",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }]
    },
    {
      "source": "/(parts\\.json|catalog/finish-options\\.json|catalog/scenes\\.json|assets/base/main/scene\\.json)",
      "headers": [{ "key": "Cache-Control", "value": "no-cache" }]
    }
  ]
}
```

Manifests (`parts.json`, `finish-options.json`, `scenes.json`, `scene.json`) stay on `no-cache` so a re-deploy is reflected immediately.

**Alternative**: leave Vercel defaults. Defaults are fine but waste a round-trip per asset on each navigation. The aggressive headers cost ~5 lines of `vercel.json` and meaningfully speed up repeat visits.

### D5. `next/image` optimization

Used in `components/finishes/FinishOptionPanel.tsx` and `components/dev/ExtractorImportPanel.tsx` for option thumbnails. Vercel runs the image optimizer transparently at request time; no config required. Confirmed by leaving `next.config.mjs`'s `images` block default.

The Konva-rendered images (mask, shading, texture) are NOT loaded via `next/image` — they're plain `Image()` instances inside `useImageCache`. Those skip the optimizer and serve the raw cached file. That's correct: Konva needs the original pixels for the destination-in composite.

### D6. Cost / tier

| Tier | Price | When we'd switch |
| --- | --- | --- |
| Hobby | $0 | Default. Sufficient for the demo phase, preview deploys included, 100 GB-Hours / mo of serverless. |
| Pro | $20 / user / mo | Required for: a custom domain on a "commercial" project (per Vercel's TOS), Vercel Analytics dashboard, Password Protection on previews, build concurrency. |
| Enterprise | contact | Not relevant at our scale. |

Recommendation: start on Hobby, upgrade to Pro only if/when the customer commits to a custom domain or wants protected previews.

### D7. Domain

Ship on `spec-drawing.vercel.app` (or whatever the assigned subdomain is — Vercel may append a hash if `spec-drawing` is taken). Custom domain (e.g. `presenter.example.co.jp`) is a 30-minute follow-up: customer creates a DNS CNAME / A record pointing at Vercel, we add the domain in the Vercel project settings, automatic certificate provisioning via Let's Encrypt.

## Risks / Trade-offs

- **[Risk] LFS quota**: Git LFS bandwidth on GitHub free is 1 GB / month. Each Vercel cold build pulls ~50 MB. ~20 cold builds / month before we hit the cap. → **Mitigation**: warm builds reuse cached LFS objects (most builds are warm). If we hit the cap, buy GitHub LFS data packs ($5 / 50 GB / mo) or move LFS storage to a different host.
- **[Risk] Preview URL accidentally indexed by search engines**: Vercel sets `X-Robots-Tag: noindex` on previews by default, but a misconfigured PR description with the URL inline could leak. → **Mitigation**: don't paste preview URLs in public-facing places; prefer the production URL for sharing.
- **[Risk] Designer accidentally edits the production-facing parts.json via `/dev/trace` on a preview**: not a real risk because preview file writes are scoped to that preview's filesystem and don't propagate. The next push to that branch overwrites the preview with the latest committed `parts.json`. → **Note in AUTHORING.md**: edits made directly on a preview deploy are NOT persisted to the repo; designers must download via the `/dev/trace` "ダウンロード" button, then commit + push.
- **[Risk] /dev/trace state mismatch on preview vs. production**: a designer edits on a preview, the customer views production simultaneously, the preview shows newer polygons than production. → **Note for the demo workflow**: customer demos use the production URL; designer iteration uses preview URLs. Switch only when a PR lands.
- **[Trade-off] Preview deployments cost in build minutes**: every PR push triggers a build (~2-5 min cold). At normal PR cadence this is negligible. If a noisy branch piles on builds, Vercel's "Skip build for current commit" or "Cancel previous builds" can be enabled.

## Migration Plan

1. Customer / project owner creates a Vercel account if they don't have one.
2. From the Vercel dashboard, "Add New Project" → import `tatoflam/SpecDrawing` from GitHub. Default settings.
3. In project Settings → General → Build & Development Settings, override the Install Command with `git lfs install --force && git lfs pull && npm install`. Build Command stays `next build`.
4. Add `vercel.json` to the repo with the cache headers from D4. (Vercel reads it on the next deploy.)
5. Update `app/api/dev/parts/route.ts` and `app/api/dev/parts/regen/route.ts`'s `devOnly()` helper per D3.
6. (Optional) Update `/dev/trace` UI to show a friendly "本番環境では無効" placeholder when the API returns 404 — the existing error toast already does this; just verify the message is clear in production.
7. Push / merge to `main` to trigger the first production deploy. Verify:
   - `/` loads the perspective with masks, shading, and finishes correctly.
   - `/api/dev/parts` returns 404.
   - `/dev/trace` UI shows the placeholder.
   - On a preview branch (push any branch + open PR), `/dev/trace` works and the dev API responds 200.
8. Document the production URL and the preview URL pattern in `README.md`.

Rollback: revert the `vercel.json` + the env-gate code changes. Vercel project can be deleted with no impact on the repo.

## Open Questions

- **Q1**: Custom domain — does the customer want one now, or is `*.vercel.app` fine for the demo phase? **A**: confirm with the customer.
- **Q2**: Should we add Vercel Password Protection on preview deploys (Pro feature) so URLs leaked outside the team don't allow `/dev/trace` writes? **A**: defer until we see if it matters; the noindex + URL obscurity is sufficient for v1.
- **Q3**: Do we want a build-time check that LFS pull actually fetched real PNGs (vs pointer files)? **A**: yes — add a tiny smoke at the end of the install command, e.g. `file -b public/assets/base/main/base_natural.jpg | grep -q JPEG` to fail the build if the JPG is still a pointer. Detail goes in `vercel.json` install command.
