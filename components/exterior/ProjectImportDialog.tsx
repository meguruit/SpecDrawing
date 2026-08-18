"use client";

import { useCallback, useRef, useState } from "react";

import {
  parseProjectFile,
  importProject,
  verifyAttachment,
  ProjectImportError,
  type ParsedProjectFile,
} from "@/lib/exterior/import";
import { useExteriorStore } from "@/lib/exterior/store";

/**
 * Two-phase project JSON import: pick the file, then re-attach one image per
 * angle. Dimensions are checked as each image is attached, so a mismatch is
 * reported at the moment it happens rather than after the import lands.
 */
export function ProjectImportDialog({ onClose }: { onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParsedProjectFile | null>(null);
  const [attached, setAttached] = useState<Map<string, File>>(new Map());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const notify = useExteriorStore((s) => s.notify);

  const pickJson = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      try {
        setParsed(parseProjectFile(await file.text()));
        setAttached(new Map());
        setErrors(new Map());
      } catch (err) {
        notify(err instanceof ProjectImportError ? err.message : String(err));
      }
    },
    [notify],
  );

  const attach = useCallback(
    async (label: string, file: File | undefined) => {
      if (!parsed || !file) return;
      const angle = parsed.angles.find((a) => a.label === label);
      if (!angle) return;
      try {
        await verifyAttachment(file, {
          width: angle.width,
          height: angle.height,
          label: angle.label,
        });
        setAttached((m) => new Map(m).set(label, file));
        setErrors((m) => {
          const next = new Map(m);
          next.delete(label);
          return next;
        });
      } catch (err) {
        setErrors((m) =>
          new Map(m).set(label, err instanceof Error ? err.message : String(err)),
        );
        setAttached((m) => {
          const next = new Map(m);
          next.delete(label);
          return next;
        });
      }
    },
    [parsed],
  );

  const commit = useCallback(async () => {
    if (!parsed) return;
    setBusy(true);
    try {
      const project = await importProject(parsed, attached, Date.now());
      const store = useExteriorStore.getState();
      useExteriorStore.setState({ projects: [project, ...store.projects] });
      await store.selectProject(project.id);
      notify(`案件「${project.name}」を読み込みました`);
      onClose();
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [parsed, attached, notify, onClose]);

  const ready = parsed !== null && parsed.angles.every((a) => attached.has(a.label));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-4 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">案件 JSON を読み込む</h2>
            <p className="mt-1 text-[11px] text-slate-500">
              JSON には画像が含まれていません。アングルごとに元の画像を選び直してください。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
          >
            閉じる
          </button>
        </div>

        {!parsed ? (
          <div className="mt-4">
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => void pickJson(e.target.files?.[0])}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
            >
              JSON ファイルを選択
            </button>
          </div>
        ) : (
          <>
            <p className="mt-3 text-xs font-medium text-slate-900">
              {parsed.name}
              <span className="ml-2 font-normal text-slate-500">
                {parsed.angles.length} アングル /{" "}
                {parsed.angles.reduce((n, a) => n + a.zones.length, 0)} ゾーン
              </span>
            </p>

            <ul className="mt-3 space-y-2">
              {parsed.angles.map((a) => {
                const ok = attached.has(a.label);
                const err = errors.get(a.label);
                return (
                  <li key={a.label} className="rounded border border-slate-200 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-slate-900">
                          {a.label}
                        </p>
                        <p className="truncate text-[10px] text-slate-500">
                          {a.filename} · {a.width}×{a.height} · {a.zones.length} ゾーン
                        </p>
                      </div>
                      <label className="shrink-0">
                        <span
                          className={[
                            "cursor-pointer rounded border px-2 py-1 text-[11px]",
                            ok
                              ? "border-emerald-500 text-emerald-700"
                              : "border-slate-300 text-slate-700 hover:border-slate-500",
                          ].join(" ")}
                        >
                          {ok ? "添付済み" : "画像を選択"}
                        </span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png"
                          className="hidden"
                          onChange={(e) => void attach(a.label, e.target.files?.[0])}
                        />
                      </label>
                    </div>
                    {err && <p className="mt-1 text-[10px] text-red-600">{err}</p>}
                  </li>
                );
              })}
            </ul>

            <button
              type="button"
              disabled={!ready || busy}
              onClick={() => void commit()}
              className="mt-4 w-full rounded bg-slate-900 px-3 py-2 text-xs font-medium text-white disabled:bg-slate-300"
            >
              {busy ? "読み込み中…" : "この内容で読み込む"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
