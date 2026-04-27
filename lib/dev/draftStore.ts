// localStorage mirror for /dev/trace edits — used as a non-blocking failover
// when the dev API can't accept a write (server stopped, validation 422, etc.).
// Disk (via /api/dev/parts) is the source of truth; this store is the safety
// net plus a draft-restore surface across reloads.
//
// Key shape: dev:trace:parts:<sceneId>
// Value: { manifest, savedAt: ISO string }
// All operations no-op safely when window is unavailable (SSR / pre-mount).

import type { PartsManifest } from "@/lib/parts/types";

const KEY_PREFIX = "dev:trace:parts:";

export type Draft = {
  manifest: PartsManifest;
  savedAt: string;
};

function key(sceneId: string): string {
  return `${KEY_PREFIX}${sceneId}`;
}

function hasWindow(): boolean {
  return typeof window !== "undefined" && !!window.localStorage;
}

export function loadDraft(sceneId: string): Draft | null {
  if (!hasWindow()) return null;
  try {
    const raw = window.localStorage.getItem(key(sceneId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Draft;
    if (!parsed?.manifest || !parsed?.savedAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveDraft(sceneId: string, manifest: PartsManifest): void {
  if (!hasWindow()) return;
  try {
    const entry: Draft = { manifest, savedAt: new Date().toISOString() };
    window.localStorage.setItem(key(sceneId), JSON.stringify(entry));
  } catch {
    // localStorage quota or serialization failure — silent; the in-memory
    // state is still correct and the autosave PUT path will retry.
  }
}

export function clearDraft(sceneId: string): void {
  if (!hasWindow()) return;
  try {
    window.localStorage.removeItem(key(sceneId));
  } catch {
    // ignore
  }
}
