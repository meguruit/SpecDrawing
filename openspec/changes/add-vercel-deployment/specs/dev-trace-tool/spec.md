## MODIFIED Requirements

### Requirement: Tool scope and gating
The `/dev/trace` page MUST only be reachable in development AND on Vercel preview deployments. Its companion API route at `/api/dev/parts` (and `/api/dev/parts/regen`) MUST respond `404` when neither `process.env.NODE_ENV === "development"` (local `npm run dev`) NOR `process.env.VERCEL_ENV === "preview"` (Vercel preview deploy) is true. The page itself SHALL still render in production (a static informational placeholder is acceptable), but no edit operations may succeed on the production deployment.

This extends the previous gate (which only accepted `NODE_ENV === "development"`) so designers can iterate against a hosted preview URL without losing the production-side protection: the customer-facing production URL still 404s on `/api/dev/parts*` and the `/dev/trace` UI degrades gracefully.

#### Scenario: Production gates disable the API
- **WHEN** the app runs on Vercel with `VERCEL_ENV === "production"` and `/api/dev/parts` is requested via `GET` or `PUT`
- **THEN** the response status is `404` and no file-system access occurs

#### Scenario: Vercel preview unlocks the API
- **WHEN** the app runs on Vercel with `VERCEL_ENV === "preview"` and `/api/dev/parts` is requested via `GET`
- **THEN** the response is `200` with the current `parts.json` body and an `mtime` field

#### Scenario: Local dev unlocks the API
- **WHEN** `npm run dev` is running locally (`NODE_ENV === "development"`) and `/api/dev/parts` is requested via `GET`
- **THEN** the response is `200` with the current `parts.json` body and an `mtime` field

#### Scenario: Edits made on a preview deploy do not propagate to the repo
- **WHEN** a designer edits `parts.json` via `/dev/trace` on a preview deploy
- **THEN** the edit is written to that preview's serverless filesystem, which is ephemeral and does not propagate back to the GitHub repo
- **AND** to persist the edit, the designer MUST download the updated `parts.json` via the existing "ダウンロード" button and commit it to a branch
