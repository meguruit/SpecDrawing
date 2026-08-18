// Capped undo/redo stack, generic over whatever snapshot a mode wants to
// keep. `/dev/trace` snapshots (editingId, polygons, marker); the exterior
// zone editor snapshots (selectedZoneId, zones). The stack semantics are the
// same either way, so they live here and each mode supplies its own entry
// type.
//
// Push semantics are the caller's responsibility and are deliberately
// terminal-only: one entry per discrete mutation (vertex add / delete /
// drag-end, ring clear, selection checkpoint, …). A drag that emits a
// hundred pointer-moves must push once, on release — never per move.

export const HISTORY_DEPTH = 30;

export class History<T> {
  private past: T[] = [];
  private future: T[] = [];

  constructor(private readonly depth: number = HISTORY_DEPTH) {}

  push(entry: T): void {
    this.past.push(entry);
    if (this.past.length > this.depth) this.past.shift();
    this.future = [];
  }

  /** Returns the entry to apply (current → previous), or null if at boundary. */
  undo(current: T): T | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(current);
    if (this.future.length > this.depth) this.future.shift();
    return prev;
  }

  /** Returns the entry to apply (current → next), or null if at boundary. */
  redo(current: T): T | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(current);
    if (this.past.length > this.depth) this.past.shift();
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
