// Mode-agnostic ring addressing and mutation over a `Polygon[]`.
//
// `/dev/trace` edits the rings of a part; the exterior editor edits the rings
// of a facade zone. Both are the same multi-ring shape (`{ outer, holes? }[]`)
// with the same operations, so the operations live here and each mode's own
// helper module adapts them to its container type.
//
// Every function is pure and returns a new array — no mutation in place.

import type { Polygon, Vertex } from "@/lib/parts/types";

/**
 * Address of one editable ring inside a `Polygon[]`: either the outer of
 * `polygons[polygonIndex]`, or the `holeIndex`-th hole inside it.
 */
export type RingAddress =
  | { kind: "outer"; polygonIndex: number }
  | { kind: "hole"; polygonIndex: number; holeIndex: number };

/** Minimum vertices for a ring to describe an area. */
export const MIN_RING_VERTICES = 3;

/** Vertices of the addressed ring, or an empty array when it does not exist. */
export function getRing(
  polygons: ReadonlyArray<Polygon>,
  at: RingAddress,
): Vertex[] {
  const poly = polygons[at.polygonIndex];
  if (!poly) return [];
  if (at.kind === "outer") return poly.outer;
  return poly.holes?.[at.holeIndex] ?? [];
}

/** Replace the addressed ring's vertices, leaving every sibling ring intact. */
export function withRing(
  polygons: ReadonlyArray<Polygon>,
  at: RingAddress,
  next: Vertex[],
): Polygon[] {
  return polygons.map((poly, pi) => {
    if (pi !== at.polygonIndex) return poly;
    if (at.kind === "outer") return { ...poly, outer: next };
    const holes = (poly.holes ?? []).map((h, hi) =>
      hi === at.holeIndex ? next : h,
    );
    return { ...poly, holes };
  });
}

/** Append a vertex at the end of the addressed ring. */
export function appendVertex(
  polygons: ReadonlyArray<Polygon>,
  at: RingAddress,
  vertex: Vertex,
): Polygon[] {
  return withRing(polygons, at, [...getRing(polygons, at), vertex]);
}

/**
 * Insert `vertex` after `edgeIndex` in the addressed ring — the placement
 * `nearestEdge` reports, so the new vertex lands between the edge's endpoints.
 */
export function insertVertexAfter(
  polygons: ReadonlyArray<Polygon>,
  at: RingAddress,
  edgeIndex: number,
  vertex: Vertex,
): Polygon[] {
  const ring = getRing(polygons, at);
  const next = [...ring];
  next.splice(edgeIndex + 1, 0, vertex);
  return withRing(polygons, at, next);
}

/** Replace one vertex of the addressed ring (used by drag). */
export function moveVertex(
  polygons: ReadonlyArray<Polygon>,
  at: RingAddress,
  vertexIndex: number,
  vertex: Vertex,
): Polygon[] {
  const ring = getRing(polygons, at);
  const next = ring.map((v, i) => (i === vertexIndex ? vertex : v));
  return withRing(polygons, at, next);
}

/**
 * Whether deleting a vertex from the addressed ring would leave it unable to
 * describe an area. Callers refuse the deletion and explain why, rather than
 * silently producing a degenerate ring the schema would later reject.
 */
export function wouldUnderflow(
  polygons: ReadonlyArray<Polygon>,
  at: RingAddress,
): boolean {
  return getRing(polygons, at).length <= MIN_RING_VERTICES;
}

/** Delete a vertex from the addressed ring. Callers must check `wouldUnderflow` first. */
export function deleteVertex(
  polygons: ReadonlyArray<Polygon>,
  at: RingAddress,
  vertexIndex: number,
): Polygon[] {
  const ring = getRing(polygons, at);
  return withRing(
    polygons,
    at,
    ring.filter((_, i) => i !== vertexIndex),
  );
}

/** Append an empty polygon entry. Its index is `length - 1`. */
export function appendPolygon(polygons: ReadonlyArray<Polygon>): Polygon[] {
  return [...polygons, { outer: [], holes: [] }];
}

/** Remove the polygon entry at `polygonIndex`. */
export function removePolygonAt(
  polygons: ReadonlyArray<Polygon>,
  polygonIndex: number,
): Polygon[] {
  return polygons.filter((_, i) => i !== polygonIndex);
}

/** Append an empty hole inside `polygons[polygonIndex]`. Its index is `holes.length - 1`. */
export function appendHole(
  polygons: ReadonlyArray<Polygon>,
  polygonIndex: number,
): Polygon[] {
  return polygons.map((poly, pi) => {
    if (pi !== polygonIndex) return poly;
    const holes = poly.holes ? [...poly.holes, []] : [[]];
    return { ...poly, holes };
  });
}

/** Remove `polygons[polygonIndex].holes[holeIndex]`. */
export function removeHoleAt(
  polygons: ReadonlyArray<Polygon>,
  polygonIndex: number,
  holeIndex: number,
): Polygon[] {
  return polygons.map((poly, pi) => {
    if (pi !== polygonIndex) return poly;
    const holes = (poly.holes ?? []).filter((_, hi) => hi !== holeIndex);
    return { ...poly, holes };
  });
}

/** Every ring of every polygon, paired with its address. Useful for rendering handles. */
export function eachRing(
  polygons: ReadonlyArray<Polygon>,
): Array<{ at: RingAddress; vertices: Vertex[] }> {
  const out: Array<{ at: RingAddress; vertices: Vertex[] }> = [];
  polygons.forEach((poly, polygonIndex) => {
    out.push({ at: { kind: "outer", polygonIndex }, vertices: poly.outer });
    poly.holes?.forEach((hole, holeIndex) => {
      out.push({
        at: { kind: "hole", polygonIndex, holeIndex },
        vertices: hole,
      });
    });
  });
  return out;
}

/** Whether two ring addresses point at the same ring. */
export function sameRing(a: RingAddress, b: RingAddress): boolean {
  if (a.kind !== b.kind) return false;
  if (a.polygonIndex !== b.polygonIndex) return false;
  if (a.kind === "hole" && b.kind === "hole") {
    return a.holeIndex === b.holeIndex;
  }
  return true;
}
