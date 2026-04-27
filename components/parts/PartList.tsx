"use client";

import { useMemo } from "react";
import { useCanvasStore } from "@/lib/canvas/store";
import type { Part } from "@/lib/parts/types";

const CATEGORY_ORDER = [
  "キッチン",
  "照明",
  "玄関",
  "室内建具",
  "床材",
  "収納アクセント",
  "サッシ",
];

const CIRCLED_DIGITS = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";

function partGlyph(id: string): string {
  const n = parseInt(id, 10);
  return Number.isFinite(n) && n >= 1 && n <= 20
    ? CIRCLED_DIGITS[n - 1]
    : `#${id}`;
}

export function PartList() {
  const parts = useCanvasStore((s) => s.parts);
  const selectedPartId = useCanvasStore((s) => s.selectedPartId);
  const selectPart = useCanvasStore((s) => s.selectPart);
  const selections = useCanvasStore((s) => s.partFinishSelections);
  const finishOptions = useCanvasStore((s) => s.finishOptions);

  const grouped = useMemo(() => {
    const known = new Map<string, Part[]>();
    const unknown: Part[] = [];
    for (const cat of CATEGORY_ORDER) known.set(cat, []);
    for (const p of parts) {
      const list = known.get(p.category);
      if (list) list.push(p);
      else unknown.push(p);
    }
    const result: Array<{ category: string; parts: Part[] }> = [];
    for (const cat of CATEGORY_ORDER) {
      const list = known.get(cat) ?? [];
      if (list.length) result.push({ category: cat, parts: list });
    }
    if (unknown.length) result.push({ category: "その他", parts: unknown });
    return result;
  }, [parts]);

  if (!parts.length) {
    return (
      <p className="text-xs text-slate-400">部材一覧を読み込み中…</p>
    );
  }

  return (
    <div className="space-y-3">
      {grouped.map(({ category, parts: items }) => (
        <div key={category}>
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
            {category}
          </h2>
          <ul className="space-y-1">
            {items.map((part) => {
              const optId = selections[part.id];
              const option = optId
                ? finishOptions.find((o) => o.id === optId)
                : undefined;
              const isActive = selectedPartId === part.id;
              return (
                <li key={part.id}>
                  <button
                    type="button"
                    onClick={() => selectPart(part.id)}
                    className={[
                      "flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left text-xs transition",
                      isActive
                        ? "border-blue-500 bg-blue-50 text-blue-900"
                        : "border-slate-200 bg-white text-slate-700 hover:border-slate-400",
                    ].join(" ")}
                  >
                    <span className="text-base font-semibold tabular-nums">
                      {partGlyph(part.id)}
                    </span>
                    <span className="flex-1">
                      <span className="block font-medium">{part.label}</span>
                      <span className="block text-[10px] text-slate-500">
                        {option ? option.label : "未選択"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
