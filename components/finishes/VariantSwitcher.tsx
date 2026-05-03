"use client";

import { useCallback, useRef } from "react";
import { useCanvasStore } from "@/lib/canvas/store";

export function VariantSwitcher() {
  const scene = useCanvasStore((s) => s.activeScene);
  const sheetsManifest = useCanvasStore((s) => s.sheetsManifest);
  const activeOptionSheet = useCanvasStore((s) => s.activeOptionSheet);
  const activeVariantKey = useCanvasStore((s) => s.activeVariantKey);
  const setActiveVariantKey = useCanvasStore((s) => s.setActiveVariantKey);

  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const sheetCfg = sheetsManifest.sheets.find((s) => s.key === activeOptionSheet);
  const variantsEnabled = !!sheetCfg?.variantsEnabled;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLButtonElement>, idx: number, total: number) => {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        const next = (idx + 1) % total;
        buttonRefs.current[next]?.focus();
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        const prev = (idx - 1 + total) % total;
        buttonRefs.current[prev]?.focus();
      }
    },
    [],
  );

  // Removed from the DOM (not just hidden) when the active sheet does not
  // enable variants, per spec.
  if (!scene || !variantsEnabled || scene.variants.length === 0) return null;

  return (
    <div
      role="radiogroup"
      aria-label="ベースパース"
      className="flex items-center gap-1.5"
    >
      <span className="text-xs text-slate-600">ベース</span>
      <div
        className="inline-flex overflow-hidden rounded border border-slate-300 bg-white"
        role="presentation"
      >
        {scene.variants.map((v, idx) => {
          const isActive = v.key === activeVariantKey;
          return (
            <button
              key={v.key}
              ref={(el) => {
                buttonRefs.current[idx] = el;
              }}
              type="button"
              role="radio"
              aria-checked={isActive}
              tabIndex={isActive ? 0 : -1}
              onClick={() => setActiveVariantKey(v.key)}
              onKeyDown={(e) => handleKeyDown(e, idx, scene.variants.length)}
              className={`px-2 py-0.5 text-xs transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${
                isActive
                  ? "bg-slate-900 text-white"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              {v.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
