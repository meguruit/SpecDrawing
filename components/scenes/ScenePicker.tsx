"use client";

import { useEffect, useState } from "react";
import {
  loadScene,
  loadScenesIndex,
  SceneLoadError,
} from "@/lib/scenes/load";
import type { ScenesIndex } from "@/lib/scenes/types";
import { useCanvasStore } from "@/lib/canvas/store";

type Props = {
  onError?: (msg: string) => void;
};

export function ScenePicker({ onError }: Props) {
  const [index, setIndex] = useState<ScenesIndex | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const activeScene = useCanvasStore((s) => s.activeScene);
  const loadSceneAction = useCanvasStore((s) => s.loadScene);

  useEffect(() => {
    let alive = true;
    loadScenesIndex()
      .then((idx) => {
        if (alive) setIndex(idx);
      })
      .catch((err: unknown) => {
        const msg =
          err instanceof SceneLoadError
            ? err.message
            : `Scene index load failed: ${(err as Error).message}`;
        onError?.(msg);
      });
    return () => {
      alive = false;
    };
  }, [onError]);

  const handlePick = async (manifestUrl: string, sceneId: string) => {
    setLoading(sceneId);
    try {
      const scene = await loadScene(manifestUrl);
      loadSceneAction(scene);
    } catch (err: unknown) {
      const msg =
        err instanceof SceneLoadError
          ? err.message
          : `Scene load failed: ${(err as Error).message}`;
      onError?.(msg);
    } finally {
      setLoading(null);
    }
  };

  if (!index) {
    return <p className="text-xs text-slate-400">シーン一覧を取得中…</p>;
  }

  return (
    <div className="space-y-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        ベースシーン
      </h2>
      <ul className="space-y-1">
        {index.scenes.map((s) => {
          const isActive = activeScene?.id === s.id;
          const isLoading = loading === s.id;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => handlePick(s.manifestUrl, s.id)}
                disabled={isLoading}
                className={[
                  "w-full rounded border px-2 py-1.5 text-left text-xs transition",
                  isActive
                    ? "border-blue-500 bg-blue-50 text-blue-900"
                    : "border-slate-200 bg-white text-slate-700 hover:border-slate-400",
                ].join(" ")}
              >
                <div className="font-medium">{s.name}</div>
                <div className="text-[10px] text-slate-400">{s.id}</div>
                {isLoading && (
                  <div className="text-[10px] text-blue-600">読み込み中…</div>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
