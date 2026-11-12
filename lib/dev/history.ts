// /dev/trace's undo/redo stack.
//
// The capped-stack mechanics moved to `lib/polygon/history.ts` so the
// exterior zone editor shares them; what stays here is the snapshot shape
// that is specific to tracing a part — (editingId, edit layer, polygons,
// marker).
//
// Push semantics: terminal mutations only (vertex add/delete, vertex
// drag-end, marker drag-end, polygon-clear, extractor-import, ring
// add/remove, hole add/remove). Switching parts also pushes a checkpoint, so
// undo can step back across part-switches.

import { History as CappedHistory } from "@/lib/polygon/history";
import type { Part, PartId } from "@/lib/parts/types";

export type HistoryEntry = {
  editingId: PartId | null;
  // Which mask layer the snapshot belongs to: null = the shared base
  // `polygons`; a variant key = that variant's `maskPolygonsByVariant` entry.
  // Undo/redo restores the polygons to the matching slot.
  editVariant: string | null;
  polygons: Part["polygons"];
  marker: Part["marker"];
};

export class History extends CappedHistory<HistoryEntry> {}
