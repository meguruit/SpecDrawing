"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Stage, Layer, Image as KonvaImage, Line, Circle, Text } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";

import { useImage } from "@/lib/canvas/useImageCache";
import {
  loadScenesIndex,
  loadScene,
  pickDefaultScene,
} from "@/lib/scenes/load";
import type { Scene } from "@/lib/scenes/types";
import type { Part, PartsManifest } from "@/lib/parts/types";

const MAX_DISPLAY_WIDTH = 1100;

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";
function glyph(id: string): string {
  const n = parseInt(id, 10);
  return Number.isFinite(n) && n >= 1 && n <= 20 ? CIRCLED[n - 1] : `#${id}`;
}

const CATEGORY_COLOR: Record<string, string> = {
  キッチン: "#F97316",
  照明: "#F59E0B",
  玄関: "#FBBF24",
  室内建具: "#3B82F6",
  床材: "#10B981",
  収納アクセント: "#F97316",
  サッシ: "#EF4444",
};

export default function TraceTool() {
  const [scene, setScene] = useState<Scene | null>(null);
  const [manifest, setManifest] = useState<PartsManifest | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stageRef = useRef<Konva.Stage>(null);

  const baseImage = useImage(scene?.baseImageUrl);

  // Load default scene + its parts manifest.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const index = await loadScenesIndex();
        const def = pickDefaultScene(index);
        const sc = await loadScene(def.manifestUrl);
        const res = await fetch(sc.partsManifestUrl, { cache: "no-store" });
        const m = (await res.json()) as PartsManifest;
        if (!alive) return;
        setScene(sc);
        setManifest(m);
        if (m.parts.length) setEditingId(m.parts[0].id);
      } catch (e: unknown) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const displayScale = useMemo(
    () => (scene ? Math.min(1, MAX_DISPLAY_WIDTH / scene.width) : 1),
    [scene],
  );

  const editingPart: Part | undefined = useMemo(
    () => manifest?.parts.find((p) => p.id === editingId),
    [manifest, editingId],
  );

  const updatePart = useCallback(
    (id: string, mutator: (p: Part) => Part) => {
      setManifest((m) =>
        m
          ? {
              ...m,
              parts: m.parts.map((p) => (p.id === id ? mutator(p) : p)),
            }
          : m,
      );
    },
    [],
  );

  const handleAddVertex = useCallback(
    (x: number, y: number) => {
      if (!editingPart) return;
      updatePart(editingPart.id, (p) => ({
        ...p,
        polygon: [...p.polygon, [Math.round(x), Math.round(y)]],
      }));
    },
    [editingPart, updatePart],
  );

  const handleMoveVertex = useCallback(
    (idx: number, x: number, y: number) => {
      if (!editingPart) return;
      updatePart(editingPart.id, (p) => {
        const next = p.polygon.slice() as Array<[number, number]>;
        next[idx] = [Math.round(x), Math.round(y)];
        return { ...p, polygon: next };
      });
    },
    [editingPart, updatePart],
  );

  const handleDeleteVertex = useCallback(
    (idx: number) => {
      if (!editingPart) return;
      updatePart(editingPart.id, (p) => ({
        ...p,
        polygon: p.polygon.filter((_, i) => i !== idx),
      }));
    },
    [editingPart, updatePart],
  );

  const handleMoveMarker = useCallback(
    (x: number, y: number) => {
      if (!editingPart) return;
      updatePart(editingPart.id, (p) => ({
        ...p,
        marker: { x: Math.round(x), y: Math.round(y) },
      }));
    },
    [editingPart, updatePart],
  );

  const handleStageClick = useCallback(
    (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
      // Only add vertex if click landed on the stage background (not a shape).
      if (e.target !== e.target.getStage()) return;
      const stage = e.target.getStage();
      const pos = stage?.getPointerPosition();
      if (!pos) return;
      handleAddVertex(pos.x / displayScale, pos.y / displayScale);
    },
    [handleAddVertex, displayScale],
  );

  const handleSave = useCallback(() => {
    if (!manifest) return;
    const blob = new Blob([JSON.stringify(manifest, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "parts.json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [manifest]);

  if (error) {
    return (
      <div className="p-4 text-sm text-red-600">
        ロードに失敗しました: {error}
      </div>
    );
  }
  if (!scene || !manifest) {
    return <div className="p-4 text-sm text-slate-400">読み込み中…</div>;
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 py-2">
        <div>
          <h1 className="text-sm font-semibold">/dev/trace</h1>
          <p className="text-[10px] text-slate-500">
            部材ポリゴン トレースツール（クリック=頂点追加 / ドラッグ=移動 / 右クリック=削除）
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            部材
            <select
              value={editingId ?? ""}
              onChange={(e) => setEditingId(e.target.value || null)}
              className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs"
            >
              {manifest.parts.map((p) => (
                <option key={p.id} value={p.id}>
                  {glyph(p.id)} {p.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={handleSave}
            className="rounded bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
          >
            parts.json をダウンロード
          </button>
        </div>
      </header>

      <div className="grid flex-1 grid-cols-[260px_1fr] overflow-hidden">
        <aside className="overflow-y-auto border-r border-slate-200 bg-slate-50 p-3 text-xs">
          {editingPart && (
            <div className="space-y-2">
              <div>
                <div className="text-base font-semibold">
                  {glyph(editingPart.id)} {editingPart.label}
                </div>
                <div className="text-[10px] text-slate-500">
                  #{editingPart.id} · {editingPart.category} · {editingPart.renderMode}
                </div>
              </div>
              <div>
                <div className="font-semibold text-slate-700">頂点</div>
                <div className="text-[10px] text-slate-500">
                  {editingPart.polygon.length} 頂点
                </div>
                <ul className="mt-1 max-h-64 overflow-y-auto rounded border border-slate-200 bg-white">
                  {editingPart.polygon.map((v, i) => (
                    <li
                      key={i}
                      className="flex items-center justify-between gap-2 border-b border-slate-100 px-2 py-1 last:border-b-0"
                    >
                      <span className="font-mono text-[11px]">
                        {i}: {v[0]}, {v[1]}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDeleteVertex(i)}
                        className="text-[11px] text-red-600 hover:underline"
                      >
                        削除
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="font-semibold text-slate-700">マーカー</div>
                <div className="font-mono text-[11px] text-slate-500">
                  ({editingPart.marker.x}, {editingPart.marker.y})
                </div>
                <p className="mt-1 text-[10px] text-slate-500">
                  キャンバス上のマーカー（白縁の円）をドラッグして位置を調整
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  updatePart(editingPart.id, (p) => ({ ...p, polygon: [] }))
                }
                className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:border-slate-400"
              >
                ポリゴンをクリア
              </button>
            </div>
          )}
        </aside>

        <main className="flex items-start justify-center overflow-auto bg-slate-100 p-4">
          <Stage
            ref={stageRef}
            width={Math.round(scene.width * displayScale)}
            height={Math.round(scene.height * displayScale)}
            scaleX={displayScale}
            scaleY={displayScale}
            onClick={handleStageClick}
            onTap={handleStageClick}
            style={{
              background: "#fff",
              boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
            }}
          >
            <Layer listening={false}>
              {baseImage && (
                <KonvaImage
                  image={baseImage}
                  x={0}
                  y={0}
                  width={scene.width}
                  height={scene.height}
                />
              )}
            </Layer>
            {/* Other parts: faint outlines for context */}
            <Layer listening={false}>
              {manifest.parts
                .filter((p) => p.id !== editingId)
                .map((p) => (
                  <Line
                    key={p.id}
                    points={p.polygon.flatMap(([x, y]) => [x, y])}
                    closed
                    stroke={CATEGORY_COLOR[p.category] ?? "#94A3B8"}
                    strokeWidth={3}
                    opacity={0.25}
                    dash={[12, 8]}
                  />
                ))}
            </Layer>
            {/* Editing part overlay */}
            {editingPart && (
              <Layer>
                <Line
                  points={editingPart.polygon.flatMap(([x, y]) => [x, y])}
                  closed
                  stroke={CATEGORY_COLOR[editingPart.category] ?? "#0F172A"}
                  strokeWidth={6}
                  fill="rgba(59,130,246,0.10)"
                />
                {editingPart.polygon.map((v, i) => (
                  <Circle
                    key={i}
                    x={v[0]}
                    y={v[1]}
                    radius={14}
                    fill="#ffffff"
                    stroke={CATEGORY_COLOR[editingPart.category] ?? "#0F172A"}
                    strokeWidth={3}
                    draggable
                    onDragMove={(ev) =>
                      handleMoveVertex(i, ev.target.x(), ev.target.y())
                    }
                    onContextMenu={(ev) => {
                      ev.evt.preventDefault();
                      handleDeleteVertex(i);
                    }}
                  />
                ))}
                {/* Marker (draggable) */}
                <Circle
                  x={editingPart.marker.x}
                  y={editingPart.marker.y}
                  radius={28}
                  fill={CATEGORY_COLOR[editingPart.category] ?? "#0F172A"}
                  stroke="#ffffff"
                  strokeWidth={4}
                  draggable
                  onDragMove={(ev) =>
                    handleMoveMarker(ev.target.x(), ev.target.y())
                  }
                />
                <Text
                  text={glyph(editingPart.id)}
                  x={editingPart.marker.x - 28}
                  y={editingPart.marker.y - 22}
                  width={56}
                  height={44}
                  fontSize={36}
                  fontStyle="bold"
                  fill="#ffffff"
                  align="center"
                  verticalAlign="middle"
                  listening={false}
                />
              </Layer>
            )}
          </Stage>
        </main>
      </div>
    </div>
  );
}
