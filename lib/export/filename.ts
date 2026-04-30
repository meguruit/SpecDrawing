export function formatExportTimestamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

export function buildExportFilename(
  sceneId: string,
  variantKey: string | null,
  timestamp: string,
  extension: "png" | "xlsx",
): string {
  const variantSegment = variantKey ?? "default";
  return `specdrawing-${sceneId}-${variantSegment}-${timestamp}.${extension}`;
}
