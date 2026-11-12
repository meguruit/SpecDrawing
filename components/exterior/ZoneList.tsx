"use client";

import { useState } from "react";

import {
  useExteriorStore,
  selectActiveAngle,
} from "@/lib/exterior/store";
import { findByCode } from "@/lib/jolypate/load";
import type { JolypateColor } from "@/lib/jolypate/schema";
import { MIN_RING_VERTICES } from "@/lib/polygon/rings";

/**
 * The active angle's zones. Order is stacking order — later entries composite
 * over earlier ones — so the reorder controls double as a z-order control.
 */
export function ZoneList({ colors }: { colors: JolypateColor[] }) {
  const angle = useExteriorStore(selectActiveAngle);
  const selectedZoneId = useExteriorStore((s) => s.selectedZoneId);
  const selectZone = useExteriorStore((s) => s.selectZone);
  const removeZone = useExteriorStore((s) => s.removeZone);
  const patchZone = useExteriorStore((s) => s.patchZone);
  const reorderZone = useExteriorStore((s) => s.reorderZone);
  const [renaming, setRenaming] = useState<string | null>(null);

  if (!angle) return null;

  if (angle.zones.length === 0) {
    return (
      <p className="rounded border border-slate-200 bg-white p-3 text-[11px] leading-relaxed text-slate-500">
        キャンバスをクリックすると新しいゾーンの作成が始まります。3 点以上で面になります。
      </p>
    );
  }

  return (
    <ul className="space-y-1">
      {angle.zones.map((zone, i) => {
        const color = findByCode(colors, zone.colorCode);
        const selected = zone.id === selectedZoneId;
        const vertices = zone.polygons.reduce((n, p) => n + p.outer.length, 0);
        return (
          <li key={zone.id}>
            <div
              className={[
                "rounded border px-2 py-1.5 transition",
                selected
                  ? "border-slate-900 bg-white shadow-sm"
                  : "border-slate-200 bg-white hover:border-slate-400",
              ].join(" ")}
            >
              <div className="flex items-center gap-2">
                <span
                  className="h-4 w-4 shrink-0 rounded-sm border border-slate-300"
                  style={{ background: color?.colorHex ?? "transparent" }}
                  aria-hidden
                />
                {renaming === zone.id ? (
                  <input
                    autoFocus
                    defaultValue={zone.label}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v) patchZone(zone.id, { label: v });
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    className="min-w-0 flex-1 rounded border border-slate-300 px-1 text-xs"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => selectZone(zone.id)}
                    onDoubleClick={() => setRenaming(zone.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-xs font-medium text-slate-900">
                      {zone.label}
                    </span>
                    <span className="block truncate text-[10px] text-slate-500">
                      {color
                        ? `${color.code}${color.nameJa ? ` ${color.nameJa}` : ""}`
                        : "色未割当"}
                      {" · "}
                      {Math.round(zone.opacity * 100)}%
                      {zone.finishTexture === "sandstone" ? " · 砂岩" : ""}
                      {vertices < MIN_RING_VERTICES ? " · 作成中" : ""}
                    </span>
                  </button>
                )}
                <div className="flex shrink-0 flex-col">
                  <button
                    type="button"
                    aria-label={`${zone.label} を前面へ`}
                    disabled={i === angle.zones.length - 1}
                    onClick={() => reorderZone(zone.id, 1)}
                    className="px-1 text-[9px] leading-none text-slate-400 hover:text-slate-900 disabled:opacity-30"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    aria-label={`${zone.label} を背面へ`}
                    disabled={i === 0}
                    onClick={() => reorderZone(zone.id, -1)}
                    className="px-1 text-[9px] leading-none text-slate-400 hover:text-slate-900 disabled:opacity-30"
                  >
                    ▼
                  </button>
                </div>
                <button
                  type="button"
                  aria-label={`${zone.label} を削除`}
                  onClick={() => {
                    // Only confirm once the zone represents real work.
                    if (
                      vertices >= MIN_RING_VERTICES &&
                      !window.confirm(`ゾーン「${zone.label}」を削除しますか？`)
                    ) {
                      return;
                    }
                    removeZone(zone.id);
                  }}
                  className="shrink-0 px-1 text-[11px] text-slate-400 hover:text-red-600"
                >
                  ×
                </button>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
