"use client";

import { useEffect } from "react";

type Props = {
  message: string | null;
  onDismiss: () => void;
};

export function Toast({ message, onDismiss }: Props) {
  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(onDismiss, 6000);
    return () => window.clearTimeout(t);
  }, [message, onDismiss]);

  if (!message) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-50 flex justify-center">
      <div
        role="alert"
        className="pointer-events-auto max-w-xl rounded-md bg-red-600 px-4 py-2 text-sm text-white shadow-lg"
      >
        <div className="flex items-start gap-3">
          <span className="flex-1 whitespace-pre-wrap">{message}</span>
          <button
            type="button"
            onClick={onDismiss}
            className="text-red-200 hover:text-white"
            aria-label="閉じる"
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}
