// Capped per-tool undo/redo stack for /dev/trace.
// Entry shape: snapshot of (editingId, polygons, marker) for the part the
// designer is working on. Switching parts also pushes a checkpoint, so
// undo can step back across part-switches.
//
// Push semantics: terminal mutations only (vertex add/delete, vertex
// drag-end, marker drag-end, polygon-clear, extractor-import, ring
// add/remove, hole add/remove).

import type { Part, PartId } from "@/lib/parts/types";

export type HistoryEntry = {
  editingId: PartId | null;
  polygons: Part["polygons"];
  marker: Part["marker"];
};

const DEPTH = 30;

export class History {
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];

  push(entry: HistoryEntry): void {
    this.past.push(entry);
    if (this.past.length > DEPTH) this.past.shift();
    this.future = [];
  }

  /** Returns the entry to apply (current → previous), or null if at boundary. */
  undo(current: HistoryEntry): HistoryEntry | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(current);
    if (this.future.length > DEPTH) this.future.shift();
    return prev;
  }

  /** Returns the entry to apply (current → next), or null if at boundary. */
  redo(current: HistoryEntry): HistoryEntry | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(current);
    if (this.past.length > DEPTH) this.past.shift();
    return next;
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  clear(): void {
    this.past = [];
    this.future = [];
  }
}
