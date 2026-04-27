"use client";

import { useMemo } from "react";
import Image from "next/image";
import { useCanvasStore } from "@/lib/canvas/store";

export function FinishOptionPanel() {
  const selectedPartId = useCanvasStore((s) => s.selectedPartId);
  const parts = useCanvasStore((s) => s.parts);
  const finishOptions = useCanvasStore((s) => s.finishOptions);
  const sheet = useCanvasStore((s) => s.activeOptionSheet);
  const selections = useCanvasStore((s) => s.partFinishSelections);
  const setFinish = useCanvasStore((s) => s.setFinish);
  const clearFinish = useCanvasStore((s) => s.clearFinish);

  const part = useMemo(
    () => (selectedPartId ? parts.find((p) => p.id === selectedPartId) : undefined),
    [selectedPartId, parts],
  );

  const options = useMemo(
    () =>
      part
        ? finishOptions.filter(
            (o) => o.partId === part.id && o.sheet === sheet,
          )
        : [],
    [finishOptions, part, sheet],
  );

  if (!part) {
    return (
      <p className="text-xs text-slate-400">
        部材を選択すると仕上げ仕様を切り替えられます
      </p>
    );
  }

  const currentId = selections[part.id];

  return (
    <div className="space-y-2">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          {part.label}
        </h2>
        <p className="text-[10px] text-slate-400">
          #{part.id} · {part.category} · {sheet}
        </p>
      </div>
      {currentId && (
        <button
          type="button"
          onClick={() => clearFinish(part.id)}
          className="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-600 hover:border-slate-400"
        >
          クリア
        </button>
      )}
      {options.length === 0 ? (
        <p className="rounded border border-dashed border-slate-300 p-3 text-center text-xs text-slate-400">
          このシートには対応する仕上げがありません
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {options.map((opt) => {
            const isActive = currentId === opt.id;
            return (
              <li key={opt.id}>
                <button
                  type="button"
                  onClick={() => setFinish(part.id, opt.id)}
                  className={[
                    "group flex w-full flex-col overflow-hidden rounded border text-left transition",
                    isActive
                      ? "border-blue-500 ring-2 ring-blue-200"
                      : "border-slate-200 hover:border-slate-400",
                  ].join(" ")}
                  title={opt.label}
                >
                  <div className="relative aspect-square w-full bg-slate-100">
                    <Image
                      src={opt.thumbnailUrl}
                      alt={opt.label}
                      fill
                      sizes="160px"
                      className="object-cover"
                    />
                  </div>
                  <div className="px-1.5 py-1 text-[11px] leading-tight text-slate-700 group-hover:text-slate-900">
                    <div className="truncate font-medium">{opt.label}</div>
                    {opt.productCode && (
                      <div className="truncate text-[10px] text-slate-400">
                        {opt.productCode}
                      </div>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
