"use client";

import { useMemo, useState } from "react";
import Image from "next/image";

import { filterColors, groupByCategory } from "@/lib/jolypate/load";
import type { JolypateColor } from "@/lib/jolypate/schema";
import { useExteriorStore, selectSelectedZone } from "@/lib/exterior/store";

const CATEGORY_LABEL: Record<string, string> = {
  NEUTRAL: "ニュートラル",
  MISTY: "ミスティ",
  SUNNY: "サニー",
  TRAD: "トラッド（和の伝統色）",
};

/**
 * Jolypate colour picker. Only orderable colours reach here — the seed drops
 * the non-tintable and special-order entries — so everything shown is
 * something the customer can actually specify.
 */
export function JolypateColorPanel({ colors }: { colors: JolypateColor[] }) {
  const [query, setQuery] = useState("");
  const zone = useExteriorStore(selectSelectedZone);
  const patchZone = useExteriorStore((s) => s.patchZone);
  const notify = useExteriorStore((s) => s.notify);

  const groups = useMemo(
    () => groupByCategory(filterColors(colors, query)),
    [colors, query],
  );

  const assign = (code: string) => {
    if (!zone) {
      notify("先にゾーンを選択してください");
      return;
    }
    patchZone(zone.id, { colorCode: code });
  };

  return (
    <section className="flex min-h-0 flex-col">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-xs font-semibold text-slate-900">ジョリパッドカラー</h2>
        <span className="text-[10px] text-slate-400">{colors.length} 色</span>
      </div>

      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="色番・色名で絞り込み"
        className="mb-2 w-full rounded border border-slate-300 px-2 py-1 text-xs"
      />

      {!zone && (
        <p className="mb-2 rounded bg-amber-50 px-2 py-1 text-[10px] text-amber-800">
          ゾーンを選択すると色を適用できます
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {groups.length === 0 && (
          <p className="py-4 text-center text-[11px] text-slate-400">
            該当する色番がありません
          </p>
        )}
        {groups.map((g) => (
          <div key={g.category} className="mb-3">
            <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {CATEGORY_LABEL[g.category] ?? g.category}
              <span className="ml-1 font-normal text-slate-400">{g.colors.length}</span>
            </h3>
            <ul className="grid grid-cols-4 gap-1">
              {g.colors.map((c) => {
                const active = zone?.colorCode === c.code;
                return (
                  <li key={c.code}>
                    <button
                      type="button"
                      onClick={() => assign(c.code)}
                      title={`${c.code}${c.nameJa ? ` ${c.nameJa}` : ""} ${c.colorHex}`}
                      className={[
                        "w-full rounded border p-0.5 transition",
                        active
                          ? "border-slate-900 ring-1 ring-slate-900"
                          : "border-slate-200 hover:border-slate-400",
                      ].join(" ")}
                    >
                      <Image
                        src={c.swatchUrl}
                        alt={c.code}
                        width={48}
                        height={32}
                        className="h-8 w-full rounded-sm object-cover"
                        unoptimized
                      />
                      <span className="mt-0.5 block truncate text-[9px] leading-tight text-slate-600">
                        {c.code}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {zone?.colorCode && (
        <button
          type="button"
          onClick={() => patchZone(zone.id, { colorCode: null })}
          className="mt-2 shrink-0 rounded border border-slate-300 px-2 py-1 text-[11px] text-slate-600 hover:border-slate-500"
        >
          このゾーンの色をクリア
        </button>
      )}
    </section>
  );
}
