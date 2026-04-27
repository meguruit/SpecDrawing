// Polygon edge geometry helpers for /dev/trace.

export type Point = [number, number];

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
 * Find the polygon edge nearest to `point`, within `tolerancePx`. Returns
 * the index of the edge's first endpoint (so the new vertex inserts at
 * `polygon[edgeIndex + 1]`) and the perpendicular foot to use as the new
 * vertex coords. Returns null if no edge is within tolerance.
 */
export function nearestEdge(
  polygon: ReadonlyArray<Point>,
  point: Point,
  tolerancePx: number,
): { edgeIndex: number; foot: Point } | null {
  if (polygon.length < 2) return null;
  let bestIndex = -1;
  let bestDistance = Infinity;
  let bestFoot: Point = [0, 0];
  const [px, py] = point;
  for (let i = 0; i < polygon.length; i++) {
    const [ax, ay] = polygon[i];
    const j = (i + 1) % polygon.length;
    const [bx, by] = polygon[j];
    const { foot, distance } = projectOnSegment(px, py, ax, ay, bx, by);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
      bestFoot = foot;
    }
  }
  if (bestDistance > tolerancePx) return null;
  return { edgeIndex: bestIndex, foot: bestFoot };
}
