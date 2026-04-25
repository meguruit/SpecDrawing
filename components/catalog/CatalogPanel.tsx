"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { loadCatalog, CatalogLoadError } from "@/lib/catalog/load";
import {
  collectAxisValues,
  filterEntries,
  type AxisSelections,
} from "@/lib/catalog/filter";
import { isKnownAxis } from "@/lib/catalog/schema";
import type { MaterialCatalog } from "@/lib/catalog/schema";
import { useCanvasStore } from "@/lib/canvas/store";

type Props = {
  onError?: (msg: string) => void;
};

export function CatalogPanel({ onError }: Props) {
  const [catalog, setCatalog] = useState<MaterialCatalog | null>(null);
  const [selections, setSelections] = useState<AxisSelections>({});
  const addMaterial = useCanvasStore((s) => s.addMaterial);

  useEffect(() => {
    let alive = true;
    loadCatalog()
      .then((c) => {
        if (alive) setCatalog(c);
      })
      .catch((err: unknown) => {
        const msg =
          err instanceof CatalogLoadError
            ? err.message
            : `Catalog load failed: ${(err as Error).message}`;
        onError?.(msg);
      });
    return () => {
      alive = false;
    };
  }, [onError]);

  const axisValues = useMemo(
    () => (catalog ? collectAxisValues(catalog.entries) : {}),
    [catalog],
  );

  const filtered = useMemo(
    () => (catalog ? filterEntries(catalog.entries, selections) : []),
    [catalog, selections],
  );

  if (!catalog) {
    return (
      <div className="p-3 text-sm text-slate-500">
        カタログを読み込み中…
      </div>
    );
  }

  const setAxis = (axis: string, value: string | undefined) =>
    setSelections((prev) => {
      const next = { ...prev };
      if (value === undefined) delete next[axis];
      else next[axis] = value;
      return next;
    });

  const knownAxisEntries = Object.entries(axisValues).filter(([k]) =>
    isKnownAxis(k),
  );
  const unknownAxisEntries = Object.entries(axisValues).filter(
    ([k]) => !isKnownAxis(k),
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          フィルタ
        </h2>
        {knownAxisEntries.map(([axis, values]) => (
          <AxisFilter
            key={axis}
            axis={axis}
            label={axis}
            values={values}
            selected={selections[axis]}
            onChange={(v) => setAxis(axis, v)}
          />
        ))}
        {unknownAxisEntries.length > 0 && (
          <details className="rounded border border-slate-200 bg-white p-2 text-xs">
            <summary className="cursor-pointer text-slate-500">
              その他の軸
            </summary>
            <div className="mt-2 space-y-2">
              {unknownAxisEntries.map(([axis, values]) => (
                <AxisFilter
                  key={axis}
                  axis={axis}
                  label={`${axis} (拡張)`}
                  values={values}
                  selected={selections[axis]}
                  onChange={(v) => setAxis(axis, v)}
                />
              ))}
            </div>
          </details>
        )}
      </div>

      <div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {filtered.length} 件
        </h2>
        {filtered.length === 0 ? (
          <p className="rounded border border-dashed border-slate-300 p-3 text-center text-xs text-slate-400">
            該当する建材がありません
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {filtered.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => addMaterial(entry.id)}
                className="group flex flex-col items-stretch overflow-hidden rounded border border-slate-200 bg-white text-left transition hover:border-slate-400"
                title={entry.name}
              >
                <div className="relative aspect-square w-full bg-slate-100">
                  <Image
                    src={entry.thumbnailUrl}
                    alt={entry.name}
                    fill
                    sizes="200px"
                    className="object-cover"
                  />
                </div>
                <div className="px-1.5 py-1 text-[11px] leading-tight text-slate-700 group-hover:text-slate-900">
                  {entry.name}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

type AxisFilterProps = {
  axis: string;
  label: string;
  values: string[];
  selected: string | undefined;
  onChange: (value: string | undefined) => void;
};

function AxisFilter({ label, values, selected, onChange }: AxisFilterProps) {
  return (
    <label className="block text-xs">
      <span className="mb-0.5 block text-slate-600">{label}</span>
      <select
        className="w-full rounded border border-slate-300 bg-white px-1.5 py-1 text-xs"
        value={selected ?? ""}
        onChange={(e) =>
          onChange(e.target.value === "" ? undefined : e.target.value)
        }
      >
        <option value="">— すべて —</option>
        {values.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    </label>
  );
}
