"use client";

import { useCanvasStore } from "@/lib/canvas/store";

export function MarkerToggle() {
  const visible = useCanvasStore((s) => s.markersVisible);
  const toggle = useCanvasStore((s) => s.toggleMarkers);

  return (
    <label className="flex items-center gap-1 text-xs text-slate-600">
      <input
        type="checkbox"
        checked={visible}
        onChange={toggle}
        className="h-3.5 w-3.5 cursor-pointer"
      />
      番号オーバーレイ
    </label>
  );
}
