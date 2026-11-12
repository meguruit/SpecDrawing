// Helpers for /dev/trace's polygon editing, expressed over a `Part`.
//
// The ring addressing and mutation logic itself is mode-agnostic and lives in
// `lib/polygon/rings.ts` — this module is the thin `Part`-shaped adapter over
// it, so `/dev/trace` keeps the API it has always used while the exterior
// facade zone editor drives the same operations over its own container.
//
// `firstOuter` / `withFirstOuter` are the legacy single-outer helpers used
// only in spots that haven't been generalized yet.

import * as rings from "@/lib/polygon/rings";
import type { RingAddress } from "@/lib/polygon/rings";
import type { Part, Polygon, Vertex } from "./types";

/**
 * Which ring the designer is editing. Alias of the mode-agnostic
 * `RingAddress` — kept under the original name for `/dev/trace`.
 */
export type ActiveRing = RingAddress;

export function firstOuter(part: Part): Vertex[] {
  return part.polygons[0]?.outer ?? [];
}

export function withFirstOuter(part: Part, nextOuter: Vertex[]): Part {
  const head: Polygon = {
    outer: nextOuter,
    holes: part.polygons[0]?.holes,
  };
  return { ...part, polygons: [head, ...part.polygons.slice(1)] };
}

/** Return the vertex array for the addressed ring (empty array if missing). */
export function getRingVertices(part: Part, active: ActiveRing): Vertex[] {
  return rings.getRing(part.polygons, active);
}

/** Replace the addressed ring's vertices with `next`, leaving siblings intact. */
export function withRingVertices(
  part: Part,
  active: ActiveRing,
  next: Vertex[],
): Part {
  return { ...part, polygons: rings.withRing(part.polygons, active, next) };
}

/** Append a fresh, empty polygon entry. The new entry's index is `length-1`. */
export function appendPolygon(part: Part): Part {
  return { ...part, polygons: rings.appendPolygon(part.polygons) };
}

/** Remove the polygon entry at `polygonIndex`. */
export function removePolygonAt(part: Part, polygonIndex: number): Part {
  return {
    ...part,
    polygons: rings.removePolygonAt(part.polygons, polygonIndex),
  };
}

/** Append a fresh, empty hole inside `polygons[polygonIndex]`. New hole's index is `holes.length-1`. */
export function appendHole(part: Part, polygonIndex: number): Part {
  return { ...part, polygons: rings.appendHole(part.polygons, polygonIndex) };
}

/** Remove `polygons[polygonIndex].holes[holeIndex]`. */
export function removeHoleAt(
  part: Part,
  polygonIndex: number,
  holeIndex: number,
): Part {
  return {
    ...part,
    polygons: rings.removeHoleAt(part.polygons, polygonIndex, holeIndex),
  };
}
