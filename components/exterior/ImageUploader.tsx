"use client";

import { useCallback, useRef, useState } from "react";

import { ingestImageFile, ImageIngestError } from "@/lib/exterior/image";
import { useExteriorStore } from "@/lib/exterior/store";

/**
 * File-picker + drag-and-drop ingest for white perspectives.
 *
 * Several files can be dropped at once; each becomes its own angle, named
 * after its file so the customer recognises it.
 */
export function ImageUploader({ compact = false }: { compact?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const addAngle = useExteriorStore((s) => s.addAngle);
  const notify = useExteriorStore((s) => s.notify);

  const ingest = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      setBusy(true);
      try {
        for (const file of Array.from(files)) {
          try {
            const stored = await ingestImageFile(file);
            const label = file.name.replace(/\.[^.]+$/, "");
            await addAngle(stored, label);
          } catch (err) {
            notify(
              err instanceof ImageIngestError
                ? err.message
                : `${file.name} を読み込めませんでした: ${(err as Error).message}`,
            );
          }
        }
      } finally {
        setBusy(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [addAngle, notify],
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void ingest(e.dataTransfer.files);
      }}
      className={[
        "rounded border-2 border-dashed text-center transition",
        compact ? "p-3" : "p-8",
        over ? "border-slate-500 bg-slate-100" : "border-slate-300 bg-white",
      ].join(" ")}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png"
        multiple
        className="hidden"
        onChange={(e) => void ingest(e.target.files)}
      />
      <p className={compact ? "text-[11px] text-slate-600" : "text-sm text-slate-600"}>
        {busy ? "読み込み中…" : "ホワイトパースをドラッグ&ドロップ"}
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="mt-2 rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-slate-700 disabled:bg-slate-300"
      >
        ファイルを選択
      </button>
      {!compact && (
        <p className="mt-2 text-[10px] text-slate-400">
          JPEG / PNG・複数選択可（1 ファイル = 1 アングル）
        </p>
      )}
    </div>
  );
}
