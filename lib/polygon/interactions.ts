// Mode-agnostic polygon-editing geometry.
//
// These are the interaction rules `/dev/trace` established, lifted out so the
// exterior facade zone editor can reuse them verbatim. Everything here is a
// pure function over plain coordinates — no React, no Konva, no persistence,
// no parts manifest. That is what lets the same rules run under the dev-only
// tracing tool and under the production-reachable exterior editor.

import type { Polygon, Vertex } from "@/lib/parts/types";
import type { RingAddress } from "./rings";

export type Point = [number, number];

/**
 * Click-to-edge tolerance, in *screen* pixels. Callers working in image
 * coordinates must divide by their display scale before passing a tolerance
 * to `nearestEdge`, so the affordance stays 12 px on screen at any zoom.
 */
export const EDGE_INSERT_TOLERANCE_PX = 12;

/**
 * Distance from point P to segment (A,B), and the perpendicular foot.
 * If the foot falls outside the segment, returns the closer endpoint.
 */
function projectOnSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): { foot: Point; distance: number } {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) {
    const dpx = px - ax;
    const dpy = py - ay;
    return { foot: [ax, ay], distance: Math.hypot(dpx, dpy) };
  }
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const fx = ax + t * dx;
  const fy = ay + t * dy;
  return { foot: [fx, fy], distance: Math.hypot(px - fx, py - fy) };
}

/**
 * Find the ring edge nearest to `point`, within `tolerancePx`. Returns the
 * index of the edge's first endpoint (so the new vertex inserts at
 * `ring[edgeIndex + 1]`), the perpendicular foot to use as the new vertex
 * coords, and the distance to that foot. Returns null if no edge is within
 * tolerance — callers fall through to "append at the end of the ring".
 */
export function nearestEdge(
  ring: ReadonlyArray<Point>,
  point: Point,
  tolerancePx: number,
): { edgeIndex: number; foot: Point; distance: number } | null {
  if (ring.length < 2) return null;
  let bestIndex = -1;
  let bestDistance = Infinity;
  let bestFoot: Point = [0, 0];
  const [px, py] = point;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i];
    const j = (i + 1) % ring.length;
    const [bx, by] = ring[j];
    const { foot, distance } = projectOnSegment(px, py, ax, ay, bx, by);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
      bestFoot = foot;
    }
  }
  if (bestDistance > tolerancePx) return null;
  return { edgeIndex: bestIndex, foot: bestFoot, distance: bestDistance };
}

export type NearestRingEdge = {
  ring: RingAddress;
  edgeIndex: number;
  foot: Point;
  distance: number;
};

/**
 * Scan every ring of every polygon and return the closest edge within
 * tolerance, along with the address of the ring it belongs to. The nearest
 * edge wins regardless of which ring is currently active, so a click near a
 * hole's edge inserts into that hole even while an outer is active.
 *
 * Returns null when nothing is within tolerance.
 */
export function nearestEdgeAcrossRings(
  polygons: ReadonlyArray<Polygon>,
  point: Point,
  tolerancePx: number,
): NearestRingEdge | null {
  let best: NearestRingEdge | null = null;
  const consider = (
    verts: ReadonlyArray<Vertex>,
    ring: RingAddress,
  ): void => {
    const hit = nearestEdge(verts as ReadonlyArray<Point>, point, tolerancePx);
    if (hit && (!best || hit.distance < best.distance)) {
      best = {
        ring,
        edgeIndex: hit.edgeIndex,
        foot: hit.foot,
        distance: hit.distance,
      };
    }
  };

  polygons.forEach((poly, polygonIndex) => {
    consider(poly.outer, { kind: "outer", polygonIndex });
    poly.holes?.forEach((hole, holeIndex) => {
      consider(hole, { kind: "hole", polygonIndex, holeIndex });
    });
  });

  return best;
}

/**
 * Index of the first vertex of `ring` within `radiusPx` of `point`, or -1.
 *
 * Konva hands vertex hits to the per-vertex `<Circle>` handlers, so the
 * interactive editors do not need this. It exists for callers that must
 * resolve a hit without a scene graph — hit-testing an exported image,
 * driving the editor from a test, or keyboard navigation.
 */
export function hitVertexIndex(
  ring: ReadonlyArray<Point>,
  point: Point,
  radiusPx: number,
): number {
  const [px, py] = point;
  let bestIndex = -1;
  let bestDistance = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [x, y] = ring[i];
    const d = Math.hypot(px - x, py - y);
    if (d <= radiusPx && d < bestDistance) {
      bestDistance = d;
      bestIndex = i;
    }
  }
  return bestIndex;
}
