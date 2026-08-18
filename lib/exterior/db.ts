import {
  exteriorProjectSchema,
  type ExteriorProject,
  type StoredImage,
} from "./types";

// Browser-local persistence for exterior projects.
//
// Two object stores, deliberately separate:
//
//   `images`   — the uploaded perspective binaries. Written once on upload,
//                read on display, deleted with their angle. Multi-megabyte.
//   `projects` — everything else: angles, zones, colours, prompts. Rewritten
//                on every edit, and small enough that rewriting it on a
//                debounce is free.
//
// Keeping them in one record would mean rewriting several megabytes of image
// every time a vertex moves.
//
// Nothing here is sent to a server. That is the whole storage story for
// exterior mode, which is why the workspace states it plainly in the UI and
// offers a JSON export as the escape hatch.

const DB_NAME = "specdrawing-exterior";
const DB_VERSION = 1;
const STORE_PROJECTS = "projects";
const STORE_IMAGES = "images";

export class ExteriorDbError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "ExteriorDbError";
    if (options?.cause) this.cause = options.cause;
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(
      new ExteriorDbError("このブラウザは IndexedDB に対応していません"),
    );
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // Version 1. Future migrations switch on `event.oldVersion` here; the
      // stores are keyed by explicit ids rather than autoIncrement so records
      // can be rewritten in place across versions.
      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        db.createObjectStore(STORE_IMAGES, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(new ExteriorDbError("IndexedDB を開けませんでした", { cause: req.error }));
    req.onblocked = () =>
      reject(
        new ExteriorDbError(
          "IndexedDB がブロックされています。このアプリの他のタブを閉じてください",
        ),
      );
  });
  return dbPromise;
}

function run<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const req = fn(tx.objectStore(storeName));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () =>
          reject(new ExteriorDbError(`IndexedDB 操作に失敗しました`, { cause: req.error }));
      }),
  );
}

// ---------------------------------------------------------------- projects

/** Records that failed validation on the last `listProjects`, for surfacing. */
export type UnreadableProject = { id: string; name: string; reason: string };
let lastUnreadable: UnreadableProject[] = [];

export function unreadableProjects(): UnreadableProject[] {
  return lastUnreadable;
}

export async function listProjects(): Promise<ExteriorProject[]> {
  const raw = await run<unknown[]>(STORE_PROJECTS, "readonly", (s) => s.getAll());
  const out: ExteriorProject[] = [];
  const bad: UnreadableProject[] = [];
  for (const r of raw) {
    const parsed = exteriorProjectSchema.safeParse(r);
    // A record written by an older or broken build must not take the whole
    // workspace down — skip it and keep the rest usable. But never skip it
    // *quietly*: from the user's side an unreadable record is indistinguish-
    // able from a deleted one, and stored bytes they cannot see is the worst
    // possible failure for browser-local data.
    if (parsed.success) {
      out.push(parsed.data);
    } else {
      const rec = r as { id?: unknown; name?: unknown };
      const issue = parsed.error.issues[0];
      bad.push({
        id: typeof rec?.id === "string" ? rec.id : "(unknown)",
        name: typeof rec?.name === "string" ? rec.name : "(名称不明)",
        reason: `${issue.path.join(".") || "(ルート)"}: ${issue.message}`,
      });
    }
  }
  lastUnreadable = bad;
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function putProject(project: ExteriorProject): Promise<void> {
  await run(STORE_PROJECTS, "readwrite", (s) => s.put(project));
}

export async function deleteProject(project: ExteriorProject): Promise<void> {
  // Reclaim the image blobs first: if this is interrupted, orphaned images
  // are recoverable via `pruneOrphanImages`, whereas a project row pointing
  // at deleted images would render broken.
  for (const angle of project.angles) {
    await deleteImage(angle.imageId).catch(() => undefined);
  }
  await run(STORE_PROJECTS, "readwrite", (s) => s.delete(project.id));
}

// ------------------------------------------------------------------ images

export async function putImage(image: StoredImage): Promise<void> {
  await run(STORE_IMAGES, "readwrite", (s) => s.put(image));
}

export async function getImage(id: string): Promise<StoredImage | null> {
  const r = await run<StoredImage | undefined>(STORE_IMAGES, "readonly", (s) => s.get(id));
  return r ?? null;
}

export async function deleteImage(id: string): Promise<void> {
  await run(STORE_IMAGES, "readwrite", (s) => s.delete(id));
}

/**
 * Drop image blobs no live project references. Deleting a project reclaims its
 * images inline; this is the sweep for anything a failed delete left behind.
 */
export async function pruneOrphanImages(): Promise<number> {
  const projects = await listProjects();
  const referenced = new Set(projects.flatMap((p) => p.angles.map((a) => a.imageId)));
  const ids = await run<IDBValidKey[]>(STORE_IMAGES, "readonly", (s) => s.getAllKeys());
  let removed = 0;
  for (const key of ids) {
    const id = String(key);
    if (!referenced.has(id)) {
      await deleteImage(id);
      removed++;
    }
  }
  return removed;
}

// ------------------------------------------------------------------- quota

export type StorageUsage = {
  usageBytes: number;
  quotaBytes: number;
  /** 0-1, or null when the browser will not say. */
  ratio: number | null;
};

export async function storageUsage(): Promise<StorageUsage | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  const est = await navigator.storage.estimate();
  const usageBytes = est.usage ?? 0;
  const quotaBytes = est.quota ?? 0;
  return {
    usageBytes,
    quotaBytes,
    ratio: quotaBytes > 0 ? usageBytes / quotaBytes : null,
  };
}

/** Bytes each project's images occupy, largest first — for the quota warning. */
export async function projectStorageBreakdown(): Promise<
  Array<{ projectId: string; name: string; bytes: number }>
> {
  const projects = await listProjects();
  const out: Array<{ projectId: string; name: string; bytes: number }> = [];
  for (const p of projects) {
    let bytes = 0;
    for (const a of p.angles) {
      const img = await getImage(a.imageId);
      bytes += img?.byteSize ?? 0;
    }
    out.push({ projectId: p.id, name: p.name, bytes });
  }
  return out.sort((a, b) => b.bytes - a.bytes);
}

/** Test seam: drop the cached connection so a fresh `open` runs. */
export function resetDbConnectionForTests(): void {
  dbPromise = null;
}
