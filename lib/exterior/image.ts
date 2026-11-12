import { MAX_IMAGE_EDGE, newId, type StoredImage } from "./types";

// Ingest for uploaded white-perspective images.
//
// Runs entirely in the browser: decode to read the intrinsic size, downscale
// if the image is larger than we want to keep, and hand back a blob ready for
// IndexedDB. Nothing is uploaded.

const ACCEPTED = new Map<string, string>([
  ["image/jpeg", "JPEG"],
  ["image/png", "PNG"],
]);

export class ImageIngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageIngestError";
  }
}

/** Human-readable type for an error message, falling back to the extension. */
function describeType(file: File): string {
  if (file.type) return file.type;
  const dot = file.name.lastIndexOf(".");
  return dot >= 0 ? file.name.slice(dot) : "不明";
}

function loadBitmap(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ImageIngestError("画像をデコードできませんでした"));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new ImageIngestError("画像の再エンコードに失敗しました"))),
      type,
      type === "image/jpeg" ? 0.92 : undefined,
    );
  });
}

/**
 * Validate, decode and (if oversized) downscale an uploaded perspective.
 *
 * Rejects anything that is not JPEG or PNG, naming the file and the type it
 * actually had — a silent rejection here reads as "drag and drop is broken".
 *
 * Images longer than `MAX_IMAGE_EDGE` on their long edge are downscaled
 * before storage. Zone coordinates are expressed in the *stored* dimensions,
 * so this must happen on ingest, before any zone can be drawn.
 */
export async function ingestImageFile(file: File): Promise<StoredImage> {
  if (!ACCEPTED.has(file.type)) {
    throw new ImageIngestError(
      `${file.name} は ${describeType(file)} です。JPEG または PNG をアップロードしてください。`,
    );
  }

  const img = await loadBitmap(file);
  const longEdge = Math.max(img.naturalWidth, img.naturalHeight);

  if (longEdge <= MAX_IMAGE_EDGE) {
    return {
      id: newId("img"),
      blob: file,
      filename: file.name,
      width: img.naturalWidth,
      height: img.naturalHeight,
      byteSize: file.size,
    };
  }

  const ratio = MAX_IMAGE_EDGE / longEdge;
  const width = Math.round(img.naturalWidth * ratio);
  const height = Math.round(img.naturalHeight * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new ImageIngestError("Canvas 2D コンテキストを取得できませんでした");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);
  const blob = await canvasToBlob(canvas, file.type);

  return {
    id: newId("img"),
    blob,
    filename: file.name,
    width,
    height,
    byteSize: blob.size,
  };
}

/** Read an image's intrinsic size without storing it — used by JSON re-import. */
export async function readImageSize(
  file: File,
): Promise<{ width: number; height: number }> {
  const img = await loadBitmap(file);
  return { width: img.naturalWidth, height: img.naturalHeight };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
