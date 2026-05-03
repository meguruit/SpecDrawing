## 1. Vercel project setup (operational, no code change)

- [x] 1.1 Create a Vercel account if the project owner doesn't have one
- [x] 1.2 Vercel Dashboard → "Add New Project" → import `tatoflam/SpecDrawing` from GitHub
  - Repo was transferred to `meguruit/SpecDrawing` (org account) and imported
    under the `meguru-construction` Vercel Pro Team because the team's GitHub
    integration is org-scoped.
- [x] 1.3 Project Settings → General → Build & Development Settings: override Install Command (see task 2.1)
  - Satisfied by committing `vercel.json` (task 2.1) — Vercel reads the JSON on
    every deploy, no UI override required.
- [x] 1.4 Verify production branch = `main`; preview deployments enabled for all branches + PRs
- [x] 1.5 Note the assigned `*.vercel.app` URL (production) and the preview URL pattern (`spec-drawing-git-<branch>-<account>.vercel.app`)
  - Initial preview slug: `spec-drawing-6aqqijf2r-meguru-construction.vercel.app`.
  - Production URL: TBD until the first `main`-branch deploy after this PR
    merges (likely `spec-drawing-meguru-construction.vercel.app`).

## 2. Repo changes for Vercel build

- [x] 2.1 Add `vercel.json` to the repo root:
  - `installCommand`: `git lfs install --force && git lfs pull && npm install`
  - Add a smoke check at the end: `file -b public/assets/base/main/base_natural.jpg | grep -q JPEG || (echo "LFS pull failed: base_natural.jpg is not a JPEG" >&2; exit 1)`
  - `buildCommand`: `next build` (default; explicit for clarity)
  - `headers`: cache config from design.md D4
  - Note: `no-cache` paths corrected to match actual file layout (`/assets/base/scenes.json`, `/assets/base/main/{scene,parts}.json`, `/catalog/{finish-options,sheets,finish-options.warnings}.json`); design.md's listed paths were stale.
- [x] 2.2 Update `app/api/dev/parts/route.ts` `devOnly()`: accept either `NODE_ENV === "development"` OR `VERCEL_ENV === "preview"`
- [x] 2.3 Same update in `app/api/dev/parts/regen/route.ts`
- [x] 2.4 In `app/dev/trace/TraceTool.client.tsx`, when the mount-time `GET /api/dev/parts` returns 404, surface a friendly placeholder ("本番環境では `/dev/trace` は無効です。プレビューデプロイ または `npm run dev` をご利用ください")
- [x] 2.5 (added during preview verification) Block `PUT /api/dev/parts` and `POST /api/dev/parts/regen` with `503 preview-readonly` when `process.env.VERCEL === "1"`; client surfaces a terminal `プレビューは保存不可 — ダウンロードしてコミット` status without retry-looping. Reason: Vercel's serverless runtime mounts the deployed app as a read-only filesystem, so the original design.md assumption that "edits land on the preview's ephemeral serverless filesystem" was wrong — writes were 500-ing and the autosave loop never terminated. design.md and dev-trace-tool spec scenarios updated accordingly.

## 3. Verification

- [x] 3.1 Push the change to a feature branch; Vercel creates a preview deployment
- [x] 3.2 On the preview URL, verify `/` loads correctly (mask, shading, finishes all serve as binaries — not LFS pointers)
- [x] 3.3 On the preview URL, verify `/dev/trace` loads and the dev API responds 200
  - Refined during verification: GET responds 200 (read works); PUT and regen POST now return `503 preview-readonly` (Vercel FS read-only) and the client surfaces a terminal `プレビューは保存不可 — ダウンロードしてコミット` status. Designer load + edit + download flow confirmed working.
- [ ] 3.4 Merge the PR to `main`; Vercel deploys to production
- [ ] 3.5 On the production URL, verify `/` still loads correctly
- [ ] 3.6 On the production URL, verify `/api/dev/parts` returns 404 and `/dev/trace` shows the placeholder

## 4. Docs

- [x] 4.1 Update `README.md` with the production URL + the preview URL pattern + a note about the `/dev/trace` gating model
- [x] 4.2 Update `AUTHORING.md` with the "edits on preview do not persist; download + commit" workflow
  - Updated `resources/reference/AUTHORING.md` (the canonical authoring guide
    referenced from `README.md`); no top-level `AUTHORING.md` exists.

## 5. Optional follow-ups (NOT in this change)

- [ ] 5.1 Custom domain (DNS handoff from customer)
- [ ] 5.2 Vercel Password Protection on previews (Pro tier)
- [ ] 5.3 Vercel Analytics (Pro tier)
- [ ] 5.4 Build concurrency on Pro for faster preview turnaround
