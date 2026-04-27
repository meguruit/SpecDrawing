## 1. Documentation tasks (this change)

- [x] 1.1 Capture the 5 follow-up items in `proposal.md` with sizing
- [x] 1.2 Record per-item design considerations in `design.md`
- [x] 1.3 Stamp placeholder modified-capability declarations in `specs/numbered-part-overlay/spec.md` and `specs/finish-spec-catalog/spec.md` so OpenSpec validation passes; concrete deltas live in the per-item follow-up changes
- [ ] 1.4 Decide priority order for the 5 items (proposal.md Q1) — needs customer / PM input

## 2. Per-item follow-up changes (NOT in this change; tracked here for visibility)

- [ ] 2.1 `add-multiring-polygons` (Items 1 + 2 bundled) — schema, mask rasterizer, hit-test, `/dev/trace` UI for sub-polygons + holes, parts.json migration
- [ ] 2.2 `add-per-option-finish-renders` (Item 3) — `customTextureUrl` field, `seed:custom-textures` step, AUTHORING.md docs, seed:parts preservation
- [ ] 2.3 `spike-ai-asset-generation` (Item 4) — 1-week research spike; output: 5 sample door-panel finishes + a go/no-go memo. Not a runtime change.
- [ ] 2.4 (Item 5) — customer asks: re-render with corrected color profile. Fallback: 1-line sharp `.modulate()` call in `cut-base-variants.mjs`. Not a runtime spec change.

## 3. Closure

- [ ] 3.1 Once the team picks priorities (1.4), open the chosen follow-up change(s) via `/opsx:propose <name>` and link this memo from each.
- [ ] 3.2 Archive this memo when all items are either implemented or explicitly dropped.
