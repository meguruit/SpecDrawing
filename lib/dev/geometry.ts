// Polygon edge geometry for /dev/trace.
//
// The implementation moved to `lib/polygon/interactions.ts` so the exterior
// facade zone editor can share the same rules. This module stays as the
// import path `/dev/trace` has always used.

export {
  nearestEdge,
  nearestEdgeAcrossRings,
  hitVertexIndex,
  EDGE_INSERT_TOLERANCE_PX,
  type Point,
  type NearestRingEdge,
} from "@/lib/polygon/interactions";
