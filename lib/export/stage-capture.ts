// Capture the live Konva stage as a PNG blob, for the export actions.
//
// The stage lives inside the `ssr: false` canvas component, but the export is
// orchestrated by the page (one click → PNG + Excel, downloaded in order).
// Rather than have both places race on the same trigger, the canvas registers
// its stage here and the page drives the capture.
//
// A module-level registry rather than canvas store state: this is a handle to
// a rendering object, not part of the presentation state model.

import type Konva from "konva";

type StageGetter = () => Konva.Stage | null;

let getStage: StageGetter | null = null;

/** Called by the canvas component on mount; pass `null` on unmount. */
export function registerExportStage(fn: StageGetter | null): void {
  getStage = fn;
}

export function hasExportStage(): boolean {
  return getStage?.() != null;
}

/** Resolve after the next paint, so DOM/Konva state changes are on screen. */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Render the stage to a PNG blob at native scene resolution.
 *
 * `pixelRatio` compensates for the on-screen display scale, so a stage shown
 * at 1100 px wide for a 3000 px scene exports at the full 3000 px.
 *
 * `beforeCapture` runs before the pixels are read and receives the stage — it
 * is where callers suppress their own affordances (selection handles, ring
 * outlines). It returns a cleanup, which runs even if the capture throws.
 */
export async function captureStagePngBlob(options: {
  pixelRatio: number;
  beforeCapture?: (stage: Konva.Stage) => () => void;
}): Promise<Blob> {
  const stage = getStage?.();
  if (!stage) throw new Error("エクスポート対象のキャンバスがありません");

  const restore = options.beforeCapture?.(stage);
  try {
    // Let the chrome-hiding render land before we read pixels.
    await nextFrame();
    // toCanvas, not toDataURL: we want bytes, not a base64 string a third
    // larger that we would immediately have to decode again.
    const canvas = stage.toCanvas({
      pixelRatio: options.pixelRatio,
    }) as HTMLCanvasElement;
    const { canvasToPngBlob } = await import("./download");
    return await canvasToPngBlob(canvas);
  } finally {
    restore?.();
  }
}
