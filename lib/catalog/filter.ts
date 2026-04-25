import type { MaterialEntry } from "./schema";

// MVP: single-select per axis. The shape allows arrays for future multi-select (OR within axis).
export type AxisSelections = Record<string, string | undefined>;

export function filterEntries(
  entries: readonly MaterialEntry[],
  selections: AxisSelections,
): MaterialEntry[] {
  const activeKeys = Object.entries(selections).filter(
    ([, v]) => v !== undefined && v !== "",
  );
  if (activeKeys.length === 0) return [...entries];
  return entries.filter((entry) =>
    activeKeys.every(([axisKey, value]) => entry.axes[axisKey] === value),
  );
}

// Build axis -> sorted distinct values, scanning every entry. Used by the filter UI.
export function collectAxisValues(
  entries: readonly MaterialEntry[],
): Record<string, string[]> {
  const out: Record<string, Set<string>> = {};
  for (const entry of entries) {
    for (const [axis, value] of Object.entries(entry.axes)) {
      if (!out[axis]) out[axis] = new Set();
      out[axis].add(value);
    }
  }
  return Object.fromEntries(
    Object.entries(out).map(([k, set]) => [k, [...set].sort()]),
  );
}
