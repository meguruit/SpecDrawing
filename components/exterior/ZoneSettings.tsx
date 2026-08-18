"use client";

import { useExteriorStore, selectSelectedZone } from "@/lib/exterior/store";
import * as rings from "@/lib/polygon/rings";

/**
 * Per-zone opacity, finish texture, and hole rings.
 *
 * Opacity matters because the white perspective already carries the lighting:
 * at 1.0 the multiply can flatten the fine surface texture the render put
 * there, so the default sits slightly below full strength and is adjustable
 * live during a customer meeting.
 */
export function ZoneSettings() {
  const zone = useExteriorStore(selectSelectedZone);
  const patchZone = useExteriorStore((s) => s.patchZone);
  const activeRing = useExteriorStore((s) => s.activeRing);
  const setActiveRing = useExteriorStore((s) => s.setActiveRing);
  const updateZoneGeometry = useExteriorStore((s) => s.updateZoneGeometry);

  if (!zone) return null;

  const holeCount = zone.polygons[0]?.holes?.length ?? 0;

  const addHole = () => {
    const next = rings.appendHole(zone.polygons, 0);
    updateZoneGeometry(zone.id, next);
    // Subsequent canvas clicks build the new hole rather than the outer.
    setActiveRing({ kind: "hole", polygonIndex: 0, holeIndex: holeCount });
  };

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

      {/* Holes cut openings — windows, doors — out of the fill, so the
          original render shows through them. */}
      <div className="mt-2 border-t border-slate-200 pt-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] text-slate-600">
            穴（窓・開口部）
            <span className="ml-1 text-slate-400">{holeCount}</span>
          </span>
          <button
            type="button"
            onClick={addHole}
            className="rounded border border-slate-300 px-2 py-0.5 text-[10px] text-slate-700 hover:border-slate-500"
          >
            ＋穴を追加
          </button>
        </div>
        {activeRing.kind === "hole" ? (
          <p className="mt-1 text-[9px] leading-tight text-amber-700">
            穴 {activeRing.holeIndex + 1} を作成中：キャンバスをクリックして囲んでください
          </p>
        ) : (
          holeCount > 0 && (
            <button
              type="button"
              onClick={() => setActiveRing({ kind: "outer", polygonIndex: 0 })}
              className="mt-1 text-[9px] text-slate-500 underline"
            >
              外周の編集に戻る
            </button>
          )
        )}
      </div>
    </section>
  );
}
