## 1. Vercel project setup (operational, no code change)

- [ ] 1.1 Create a Vercel account if the project owner doesn't have one
- [ ] 1.2 Vercel Dashboard → "Add New Project" → import `tatoflam/SpecDrawing` from GitHub
- [ ] 1.3 Project Settings → General → Build & Development Settings: override Install Command (see task 2.1)
- [ ] 1.4 Verify production branch = `main`; preview deployments enabled for all branches + PRs
- [ ] 1.5 Note the assigned `*.vercel.app` URL (production) and the preview URL pattern (`spec-drawing-git-<branch>-<account>.vercel.app`)

## 2. Repo changes for Vercel build

- [ ] 2.1 Add `vercel.json` to the repo root:
  - `installCommand`: `git lfs install --force && git lfs pull && npm install`
  - Add a smoke check at the end: `file -b public/assets/base/main/base_natural.jpg | grep -q JPEG || (echo "LFS pull failed: base_natural.jpg is not a JPEG" >&2; exit 1)`
  - `buildCommand`: `next build` (default; explicit for clarity)
  - `headers`: cache config from design.md D4
- [ ] 2.2 Update `app/api/dev/parts/route.ts` `devOnly()`: accept either `NODE_ENV === "development"` OR `VERCEL_ENV === "preview"`
- [ ] 2.3 Same update in `app/api/dev/parts/regen/route.ts`
- [ ] 2.4 In `app/dev/trace/TraceTool.client.tsx`, when the mount-time `GET /api/dev/parts` returns 404, surface a friendly placeholder ("本番環境では `/dev/trace` は無効です。プレビューデプロイ または `npm run dev` をご利用ください")

## 3. Verification

- [ ] 3.1 Push the change to a feature branch; Vercel creates a preview deployment
- [ ] 3.2 On the preview URL, verify `/` loads correctly (mask, shading, finishes all serve as binaries — not LFS pointers)
- [ ] 3.3 On the preview URL, verify `/dev/trace` loads and the dev API responds 200
- [ ] 3.4 Merge the PR to `main`; Vercel deploys to production
- [ ] 3.5 On the production URL, verify `/` still loads correctly
- [ ] 3.6 On the production URL, verify `/api/dev/parts` returns 404 and `/dev/trace` shows the placeholder

## 4. Docs

- [ ] 4.1 Update `README.md` with the production URL + the preview URL pattern + a note about the `/dev/trace` gating model
- [ ] 4.2 Update `AUTHORING.md` with the "edits on preview do not persist; download + commit" workflow

## 5. Optional follow-ups (NOT in this change)

- [ ] 5.1 Custom domain (DNS handoff from customer)
- [ ] 5.2 Vercel Password Protection on previews (Pro tier)
- [ ] 5.3 Vercel Analytics (Pro tier)
- [ ] 5.4 Build concurrency on Pro for faster preview turnaround
