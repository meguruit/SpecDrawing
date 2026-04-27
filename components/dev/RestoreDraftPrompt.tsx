"use client";

type Props = {
  diskMtime: string;
  draftSavedAt: string;
  onRestore: () => void;
  onDiscard: () => void;
};

function formatTs(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ja-JP", { hour12: false });
  } catch {
    return iso;
  }
}

export function RestoreDraftPrompt({
  diskMtime,
  draftSavedAt,
  onRestore,
  onDiscard,
}: Props) {
  return (
    <div
      role="dialog"
      className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
    >
      <div className="font-semibold">未保存ドラフトがあります</div>
      <ul className="mt-1 space-y-0.5">
        <li>
          ディスク版: <span className="font-mono">{formatTs(diskMtime)}</span>
        </li>
        <li>
          ドラフト: <span className="font-mono">{formatTs(draftSavedAt)}</span>
        </li>
      </ul>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          onClick={onRestore}
          className="rounded bg-amber-700 px-2 py-1 text-white hover:bg-amber-800"
        >
          ドラフトを復元
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="rounded border border-amber-700 bg-white px-2 py-1 text-amber-800 hover:bg-amber-100"
        >
          破棄
        </button>
      </div>
    </div>
  );
}
