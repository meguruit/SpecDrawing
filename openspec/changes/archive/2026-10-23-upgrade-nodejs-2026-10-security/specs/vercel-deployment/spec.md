## ADDED Requirements

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
