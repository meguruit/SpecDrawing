## MODIFIED Requirements

### Requirement: Tool scope and gating
The `/dev/trace` page MUST only be reachable in development AND on Vercel preview deployments. Its companion API route at `/api/dev/parts` (and `/api/dev/parts/regen`) MUST respond `404` when neither `process.env.NODE_ENV === "development"` (local `npm run dev`) NOR `process.env.VERCEL_ENV === "preview"` (Vercel preview deploy) is true. The page itself SHALL still render in production (a static informational placeholder is acceptable), but no edit operations may succeed on the production deployment.

This extends the previous gate (which only accepted `NODE_ENV === "development"`) so designers can iterate against a hosted preview URL without losing the production-side protection: the customer-facing production URL still 404s on `/api/dev/parts*` and the `/dev/trace` UI degrades gracefully.

#### Scenario: Production gates disable the API
- **WHEN** the app runs on Vercel with `VERCEL_ENV === "production"` and `/api/dev/parts` is requested via `GET` or `PUT`
- **THEN** the response status is `404` and no file-system access occurs

#### Scenario: Vercel preview unlocks the API for reads
- **WHEN** the app runs on Vercel with `VERCEL_ENV === "preview"` and `/api/dev/parts` is requested via `GET`
- **THEN** the response is `200` with the current `parts.json` body and an `mtime` field

#### Scenario: Local dev unlocks the API
- **WHEN** `npm run dev` is running locally (`NODE_ENV === "development"`) and `/api/dev/parts` is requested via `GET`
- **THEN** the response is `200` with the current `parts.json` body and an `mtime` field

#### Scenario: Edits made on a preview deploy stay in the browser
- **WHEN** a designer edits `parts.json` via `/dev/trace` on a preview deploy and the autosave fires `PUT /api/dev/parts`
- **THEN** the response is `503` with `{ error: "preview-readonly" }` because Vercel's serverless runtime mounts the deployed app as a read-only filesystem (only `/tmp` is writable, and even that is per-instance and ephemeral) — `writeFile` against `public/assets/base/main/parts.json` would fail with `EROFS` if attempted
- **AND** the `/dev/trace` UI surfaces a terminal `プレビューは保存不可 — ダウンロードしてコミット` status (no retry loop) so the designer is steered to the persistence path
- **AND** the edit lives only in the browser's localStorage mirror until the designer clicks "ダウンロード" and commits the resulting `parts.json` to a branch — the next preview deploy reflects the committed file

#### Scenario: Mask regen on a preview deploy is blocked the same way
- **WHEN** the autosave-triggered regen fires `POST /api/dev/parts/regen` on a Vercel preview
- **THEN** the response is `503` with `{ error: "preview-readonly" }` (regen would write `mask_<NN>.png` / `shading_<NN>.png` PNGs back into `public/`, which is read-only)
- **AND** the `/dev/trace` UI surfaces `マスク再生成 不可（プレビュー）`; mask updates land via local-dev regen + commit + redeploy
