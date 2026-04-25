"use client";

import { useCanvasStore } from "@/lib/canvas/store";

export function PartColorPicker() {
  const scene = useCanvasStore((s) => s.activeScene);
  const overrides = useCanvasStore((s) => s.colorOverrides);
  const setPartColor = useCanvasStore((s) => s.setPartColor);
  const clearPartColor = useCanvasStore((s) => s.clearPartColor);

  if (!scene) {
    return (
      <p className="text-xs text-slate-400">
        色の調整はシーンを読み込んでから行えます
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        色の上書き
      </h2>
      <ul className="space-y-1.5">
        {scene.parts.map((part) => {
          const value = overrides[part.id];
          return (
            <li
              key={part.id}
              className="flex items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1.5"
            >
              <span className="flex-1 text-xs text-slate-700">
                {part.label}
                <span className="ml-1 text-[10px] text-slate-400">
                  ({part.id})
                </span>
              </span>
              <input
                type="color"
                value={value ?? "#cccccc"}
                onChange={(e) => setPartColor(part.id, e.target.value)}
                className="h-7 w-10 cursor-pointer rounded border border-slate-300 bg-white"
                aria-label={`${part.label} の色`}
              />
              <button
                type="button"
                onClick={() => clearPartColor(part.id)}
                disabled={!value}
                className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] text-slate-600 disabled:opacity-40"
              >
                クリア
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
