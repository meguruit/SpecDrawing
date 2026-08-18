// Shared browser-download plumbing for the export actions.
//
// Two hazards this exists to avoid:
//
// 1. **`data:` URLs.** A native-resolution stage export is ~11 MB of PNG,
//    which becomes a ~15 MB base64 string. Chrome's anchor-download path
//    degrades badly on data URLs that large — and the base64 round-trip
//    costs a third more memory than the bytes themselves. Blob object URLs
//    have no such ceiling, so every download here goes through one.
//
// 2. **Revoking too early.** Revoking the object URL on the same tick as
//    `a.click()` races the browser's claim on the blob. We hand the URL back
//    to the caller's task queue before revoking.
//
// Downloads are also serialized: firing several in one burst from a single
// click is what trips Chrome's "automatic downloads" gate, after which
// everything past the first file fails silently.

/** Give the browser a task tick to claim the blob before we drop it. */
const REVOKE_DELAY_MS = 60_000;

/** Gap between files of a multi-file export, so they don't read as a burst. */
const SEQUENTIAL_GAP_MS = 350;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Trigger a download of `blob` as `filename`.
 *
 * The returned promise settles once the click has been dispatched — it does
 * not (and cannot) tell you whether the browser actually wrote the file. A
 * browser that blocks the download reports nothing to the page.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Deliberately not revoked on this tick — see the note above. The delay is
  // generous because an abandoned object URL costs only its own bytes and is
  // reclaimed on navigation anyway.
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

/**
 * Download several files one after another, with a gap between them.
 *
 * Chrome treats N files from one user gesture as a single "download multiple
 * files" request and gates it behind a permission. Once a user (or an
 * enterprise policy) blocks that permission for the origin, every file after
 * the first is dropped with no error surfaced to the page — which reads
 * exactly like "the button did nothing".
 */
export async function downloadBlobsSequentially(
  files: ReadonlyArray<{ blob: Blob; filename: string }>,
): Promise<void> {
  for (let i = 0; i < files.length; i++) {
    if (i > 0) await delay(SEQUENTIAL_GAP_MS);
    downloadBlob(files[i].blob, files[i].filename);
  }
}

/**
 * Encode a canvas to a PNG Blob.
 *
 * `canvas.toBlob` goes straight to bytes; `toDataURL` would base64 the same
 * pixels into a string a third larger, only for us to decode it again.
 */
export function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("canvas.toBlob returned null (canvas too large?)"));
    }, "image/png");
  });
}
