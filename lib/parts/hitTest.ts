// Shared point-in-part test for runtime + /dev/trace.
// A click hits a part if it lies inside any outer ring AND outside every
// hole declared on that outer.

import type { Part, Polygon, Vertex } from "./types";

export function pointInRing(
  x: number,
  y: number,
  ring: ReadonlyArray<Vertex>,
): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect =
      yi > y !== yj > y &&
      x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function pointInPolygon(
  x: number,
  y: number,
  polygon: Polygon,
): boolean {
  if (!pointInRing(x, y, polygon.outer)) return false;
  if (polygon.holes) {
    for (const hole of polygon.holes) {
      if (pointInRing(x, y, hole)) return false;
    }
  }
  return true;
}

export function pointInPart(part: Part, x: number, y: number): boolean {
  for (const poly of part.polygons) {
    if (pointInPolygon(x, y, poly)) return true;
  }
  return false;
}

// Find the first part whose region contains (x, y), iterating in reverse
// declaration order so later-declared parts win on overlap. Mirrors the
// composite layer ordering in `color-composition`.
export function findPartAt(
  x: number,
  y: number,
  parts: ReadonlyArray<Part>,
): string | null {
  for (let i = parts.length - 1; i >= 0; i--) {
    if (pointInPart(parts[i], x, y)) return parts[i].id;
  }
  return null;
}
