"use client";

import { useExteriorStore, selectSelectedZone } from "@/lib/exterior/store";

/**
 * Per-zone opacity and finish texture.
 *
 * Opacity matters because the white perspective already carries the lighting:
 * at 1.0 the multiply can flatten the fine surface texture the render put
 * there, so the default sits slightly below full strength and is adjustable
 * live during a customer meeting.
 */
export function ZoneSettings() {
  const zone = useExteriorStore(selectSelectedZone);
  const patchZone = useExteriorStore((s) => s.patchZone);

  if (!zone) return null;

  return (
    <section className="rounded border border-slate-200 bg-white p-2">
      <h2 className="mb-2 truncate text-xs font-semibold text-slate-900">
        {zone.label}
      </h2>

      <label className="block">
        <span className="flex items-baseline justify-between text-[10px] text-slate-600">
          不透明度
          <span className="font-mono text-slate-900">
            {Math.round(zone.opacity * 100)}%
          </span>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={zone.opacity}
          onChange={(e) => patchZone(zone.id, { opacity: Number(e.target.value) })}
          className="mt-1 w-full"
        />
      </label>
      <p className="mt-1 text-[9px] leading-tight text-slate-400">
        下げるほどホワイトパースの陰影が透けます
      </p>

      <label className="mt-2 flex items-center gap-2">
        <input
          type="checkbox"
          checked={zone.finishTexture === "sandstone"}
          onChange={(e) =>
            patchZone(zone.id, { finishTexture: e.target.checked ? "sandstone" : null })
          }
        />
        <span className="text-[11px] text-slate-700">砂岩風仕上げ</span>
      </label>
    </section>
  );
}
