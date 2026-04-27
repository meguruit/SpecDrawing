"use client";

import { useMemo } from "react";
import { useCanvasStore } from "@/lib/canvas/store";

export function SheetSwitcher() {
  const finishOptions = useCanvasStore((s) => s.finishOptions);
  const active = useCanvasStore((s) => s.activeOptionSheet);
  const setActiveSheet = useCanvasStore((s) => s.setActiveSheet);

  const sheets = useMemo(
    () =>
      Array.from(new Set(finishOptions.map((o) => o.sheet))).sort(),
    [finishOptions],
  );

  if (sheets.length <= 1) return null;

  return (
    <label className="flex items-center gap-1.5 text-xs text-slate-600">
      シート
      <select
        value={active}
        onChange={(e) => setActiveSheet(e.target.value)}
        className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs"
      >
        {sheets.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </label>
  );
}
