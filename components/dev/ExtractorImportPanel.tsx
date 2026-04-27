"use client";

import { useMemo, useState } from "react";
import type { Part, PartsManifest } from "@/lib/parts/types";

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
function glyph(id: string): string {
  const n = parseInt(id, 10);
  return Number.isFinite(n) && n >= 1 && n <= 20 ? CIRCLED[n - 1] : `#${id}`;
}

function bboxOf(polygon: Part["polygon"]): { w: number; h: number } | null {
  if (!polygon.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of polygon) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { w: Math.round(maxX - minX), h: Math.round(maxY - minY) };
}

type RowState = { polygon: boolean; marker: boolean };

type Props = {
  current: PartsManifest;
  extracted: PartsManifest;
  onClose: () => void;
  onApply: (
    selections: Record<string, RowState>,
  ) => void;
};

export function ExtractorImportPanel({
  current,
  extracted,
  onClose,
  onApply,
}: Props) {
  const extById = useMemo(
    () => new Map(extracted.parts.map((p) => [p.id, p])),
    [extracted],
  );

  const rows = useMemo(() => {
    return current.parts.map((p) => {
      const ex = extById.get(p.id);
      return {
        partId: p.id,
        label: p.label,
        currentVertices: p.polygon.length,
        currentBbox: bboxOf(p.polygon),
        currentMarker: p.marker,
        extractedVertices: ex?.polygon.length ?? 0,
        extractedBbox: ex ? bboxOf(ex.polygon) : null,
        extractedMarker: ex?.marker ?? null,
        canImportPolygon: !!ex && ex.polygon.length >= 3,
        canImportMarker: !!ex && !!ex.marker,
      };
    });
  }, [current, extById]);

  const [selections, setSelections] = useState<Record<string, RowState>>(
    () =>
      Object.fromEntries(
        rows.map((r) => [r.partId, { polygon: false, marker: false }]),
      ),
  );

  const totalSelected = Object.values(selections).reduce(
    (acc, s) => acc + (s.polygon ? 1 : 0) + (s.marker ? 1 : 0),
    0,
  );

  const toggle = (partId: string, key: keyof RowState) =>
    setSelections((prev) => ({
      ...prev,
      [partId]: { ...prev[partId], [key]: !prev[partId][key] },
    }));

  return (
    <div
      role="dialog"
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4"
    >
      <div className="flex max-h-[85vh] w-[720px] max-w-full flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold">抽出結果のインポート</h2>
            <p className="text-[11px] text-slate-500">
              現在の値と抽出結果を比較し、部材ごとに polygon / marker を選択してインポートします。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
          >
            閉じる
          </button>
        </header>
        <div className="overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-100 text-slate-600">
              <tr>
                <th className="px-2 py-1 text-left">部材</th>
                <th className="px-2 py-1 text-left">現在 polygon</th>
                <th className="px-2 py-1 text-left">抽出 polygon</th>
                <th className="px-2 py-1 text-center">取込</th>
                <th className="px-2 py-1 text-left">現在 marker</th>
                <th className="px-2 py-1 text-left">抽出 marker</th>
                <th className="px-2 py-1 text-center">取込</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.partId} className="border-b border-slate-100">
                  <td className="px-2 py-1.5">
                    <span className="font-semibold">{glyph(r.partId)}</span>{" "}
                    <span className="text-slate-600">{r.label}</span>
                  </td>
                  <td className="px-2 py-1.5 font-mono text-[11px]">
                    {r.currentVertices}pt
                    {r.currentBbox &&
                      ` ${r.currentBbox.w}×${r.currentBbox.h}`}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-[11px]">
                    {r.canImportPolygon
                      ? `${r.extractedVertices}pt${r.extractedBbox ? ` ${r.extractedBbox.w}×${r.extractedBbox.h}` : ""}`
                      : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <input
                      type="checkbox"
                      disabled={!r.canImportPolygon}
                      checked={selections[r.partId]?.polygon ?? false}
                      onChange={() => toggle(r.partId, "polygon")}
                    />
                  </td>
                  <td className="px-2 py-1.5 font-mono text-[11px]">
                    {r.currentMarker.x},{r.currentMarker.y}
                  </td>
                  <td className="px-2 py-1.5 font-mono text-[11px]">
                    {r.extractedMarker
                      ? `${r.extractedMarker.x},${r.extractedMarker.y}`
                      : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <input
                      type="checkbox"
                      disabled={!r.canImportMarker}
                      checked={selections[r.partId]?.marker ?? false}
                      onChange={() => toggle(r.partId, "marker")}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <footer className="flex items-center justify-between gap-3 border-t border-slate-200 px-4 py-3">
          <span className="text-xs text-slate-500">
            選択: {totalSelected} 項目
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={() => onApply(selections)}
              disabled={totalSelected === 0}
              className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              選択をインポート
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
