// Helpers for /dev/trace's polygon editing. The tool operates on one ring
// at a time — addressed by an `ActiveRing` discriminator that says whether
// the designer is editing the outer of `polygons[i]` or the j-th hole
// inside `polygons[i].holes`.
//
// `firstOuter` / `withFirstOuter` are the legacy single-outer helpers used
// only in spots that haven't been generalized yet.

import type { Part, Polygon, Vertex } from "./types";

export type ActiveRing =
  | { kind: "outer"; polygonIndex: number }
  | { kind: "hole"; polygonIndex: number; holeIndex: number };

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
  const poly = part.polygons[active.polygonIndex];
  if (!poly) return [];
  if (active.kind === "outer") return poly.outer;
  return poly.holes?.[active.holeIndex] ?? [];
}

/** Replace the addressed ring's vertices with `next`, leaving siblings intact. */
export function withRingVertices(
  part: Part,
  active: ActiveRing,
  next: Vertex[],
): Part {
  const polygons = part.polygons.map((poly, pi) => {
    if (pi !== active.polygonIndex) return poly;
    if (active.kind === "outer") {
      return { ...poly, outer: next };
    }
    const holes = (poly.holes ?? []).map((h, hi) =>
      hi === active.holeIndex ? next : h,
    );
    return { ...poly, holes };
  });
  return { ...part, polygons };
}

/** Append a fresh, empty polygon entry. The new entry's index is `length-1`. */
export function appendPolygon(part: Part): Part {
  return {
    ...part,
    polygons: [...part.polygons, { outer: [], holes: [] }],
  };
}

/** Remove the polygon entry at `polygonIndex`. */
export function removePolygonAt(part: Part, polygonIndex: number): Part {
  return {
    ...part,
    polygons: part.polygons.filter((_, i) => i !== polygonIndex),
  };
}

/** Append a fresh, empty hole inside `polygons[polygonIndex]`. New hole's index is `holes.length-1`. */
export function appendHole(part: Part, polygonIndex: number): Part {
  const polygons = part.polygons.map((poly, pi) => {
    if (pi !== polygonIndex) return poly;
    const holes = poly.holes ? [...poly.holes, []] : [[]];
    return { ...poly, holes };
  });
  return { ...part, polygons };
}

/** Remove `polygons[polygonIndex].holes[holeIndex]`. */
export function removeHoleAt(
  part: Part,
  polygonIndex: number,
  holeIndex: number,
): Part {
  const polygons = part.polygons.map((poly, pi) => {
    if (pi !== polygonIndex) return poly;
    const holes = (poly.holes ?? []).filter((_, hi) => hi !== holeIndex);
    return { ...poly, holes };
  });
  return { ...part, polygons };
}
