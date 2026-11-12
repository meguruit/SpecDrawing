"use client";

import { useState } from "react";

import {
  useExteriorStore,
  selectActiveProject,
  selectActiveAngle,
} from "@/lib/exterior/store";
import { formatBytes } from "@/lib/exterior/image";

/** Project picker + angle tabs + storage notice. */
export function ProjectBar() {
  const projects = useExteriorStore((s) => s.projects);
  const project = useExteriorStore(selectActiveProject);
  const angle = useExteriorStore(selectActiveAngle);
  const usage = useExteriorStore((s) => s.usage);
  const addProject = useExteriorStore((s) => s.addProject);
  const selectProject = useExteriorStore((s) => s.selectProject);
  const removeProject = useExteriorStore((s) => s.removeProject);
  const selectAngle = useExteriorStore((s) => s.selectAngle);
  const renameAngle = useExteriorStore((s) => s.renameAngle);
  const removeAngle = useExteriorStore((s) => s.removeAngle);
  const [renaming, setRenaming] = useState<string | null>(null);
  // Inline field rather than window.prompt: a native prompt blocks the page,
  // is suppressed outright in some embedding contexts, and cannot be styled
  // or validated.
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");

  const commitCreate = async () => {
    const name = draftName.trim();
    if (!name) {
      setCreating(false);
      setDraftName("");
      return;
    }
    await addProject(name);
    setCreating(false);
    setDraftName("");
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <select
          value={project?.id ?? ""}
          onChange={(e) => void selectProject(e.target.value)}
          disabled={projects.length === 0}
          aria-label="案件"
          className="max-w-[200px] rounded border border-slate-300 px-2 py-1 text-xs disabled:bg-slate-100"
        >
          {projects.length === 0 && <option value="">案件がありません</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {creating ? (
          <input
            autoFocus
            value={draftName}
            aria-label="新しい案件名"
            placeholder="案件名"
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={() => void commitCreate()}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setDraftName("");
                setCreating(false);
              }
            }}
            className="w-32 rounded border border-slate-400 px-2 py-1 text-xs"
          />
        ) : (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:border-slate-500"
          >
            ＋案件
          </button>
        )}
        {project && (
          <button
            type="button"
            onClick={() => {
              if (
                window.confirm(
                  `案件「${project.name}」と ${project.angles.length} 件の画像を削除します。元に戻せません。`,
                )
              ) {
                void removeProject(project.id);
              }
            }}
            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:border-red-400 hover:text-red-600"
          >
            案件を削除
          </button>
        )}
      </div>

      {project && project.angles.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {project.angles.map((a) => {
            const active = a.id === angle?.id;
            return (
              <span
                key={a.id}
                className={[
                  "group inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px]",
                  active
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:border-slate-500",
                ].join(" ")}
              >
                {renaming === a.id ? (
                  <input
                    autoFocus
                    defaultValue={a.label}
                    onBlur={(e) => {
                      renameAngle(a.id, e.target.value);
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    className="w-24 rounded border border-slate-300 px-1 text-[11px] text-slate-900"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => void selectAngle(a.id)}
                    onDoubleClick={() => setRenaming(a.id)}
                  >
                    {a.label}
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`アングル ${a.label} を削除`}
                  onClick={() => {
                    if (window.confirm(`アングル「${a.label}」とそのゾーンを削除しますか？`)) {
                      void removeAngle(a.id);
                    }
                  }}
                  className="opacity-50 hover:opacity-100"
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}

      <p className="text-[9px] leading-tight text-slate-400">
        このデータはこのブラウザにのみ保存されています（サーバへは送信されません）
        {usage && usage.ratio !== null && (
          <>
            {" · "}使用量 {formatBytes(usage.usageBytes)}
            {usage.ratio > 0.8 && (
              <strong className="ml-1 text-amber-700">
                空き容量が少なくなっています。不要な案件を削除してください
              </strong>
            )}
          </>
        )}
      </p>
    </div>
  );
}
