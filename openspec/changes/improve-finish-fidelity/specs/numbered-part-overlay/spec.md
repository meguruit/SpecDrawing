## ADDED Requirements

<!--
This change is a proposal-only scope memo. No spec text is added by this
change. The two items below are placeholders so OpenSpec validation
recognizes the modified-capability declaration; concrete requirement
text + scenarios will land in the follow-up changes named in
proposal.md (`add-multiring-polygons` for items 1 + 2).
-->

### Requirement: Multi-region and holed polygons (placeholder for follow-up)
Detailed requirement and scenarios to be authored in change `add-multiring-polygons`. Captures: a part SHALL be able to declare multiple disjoint polygon regions and each region SHALL be able to declare interior holes. The runtime mask rasterizer, hit-test, and `/dev/trace` UI all extend accordingly. The schema migration wraps existing single-polygon parts in a 1-element array of `{ outer: <existing>, holes: [] }` for backward compatibility.

#### Scenario: Placeholder — see follow-up change for full scenarios
- **WHEN** the follow-up change `add-multiring-polygons` is implemented
- **THEN** this placeholder requirement is replaced with concrete WHEN/THEN scenarios covering multi-region rendering, hole subtraction, and migration
