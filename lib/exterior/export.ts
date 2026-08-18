import { downloadBlobsSequentially } from "@/lib/export/download";
import { captureStagePngBlob } from "@/lib/export/stage-capture";
import { findByCode } from "@/lib/jolypate/load";
import type { JolypateColor } from "@/lib/jolypate/schema";
import { EXTRAS_CATEGORIES, slugify, type ExteriorProject } from "./types";

// Exterior export: the composited PNG per angle, plus one spec workbook.

/** `specdrawing-ext-<project>-<angle>-<ts>.png` / `-<project>-<ts>.xlsx`. */
export function buildExteriorExportFilename(
  projectName: string,
  angleName: string | null,
  timestamp: string,
  extension: "png" | "xlsx",
): string {
  const project = slugify(projectName);
  if (angleName === null) return `specdrawing-ext-${project}-${timestamp}.${extension}`;
  return `specdrawing-ext-${project}-${slugify(angleName)}-${timestamp}.${extension}`;
}

/**
 * Capture the live stage, with the editing affordances hidden.
 *
 * Handles and outlines live on a named layer so they can be hidden for the
 * capture and restored afterwards — an export must show the customer the
 * result, not the editor.
 */
export async function captureAnglePng(pixelRatio: number): Promise<Blob> {
  return captureStagePngBlob({
    pixelRatio,
    beforeCapture: (stage) => {
      const chrome = stage.findOne(".editor-chrome");
      if (!chrome || !chrome.visible()) return () => undefined;
      chrome.visible(false);
      return () => {
        chrome.visible(true);
        stage.batchDraw();
      };
    },
  });
}

export type ExteriorSpecRow = {
  angle: string;
  zone: string;
  code: string;
  nameJa: string;
  category: string;
  opacity: number;
  sandstone: string;
  swatchUrl: string | null;
};

/** One row per zone, grouped by angle and ordered within an angle by stacking order. */
export function buildSpecRows(
  project: ExteriorProject,
  colors: ReadonlyArray<JolypateColor>,
): ExteriorSpecRow[] {
  const rows: ExteriorSpecRow[] = [];
  for (const angle of project.angles) {
    for (const zone of angle.zones) {
      const c = findByCode(colors, zone.colorCode);
      rows.push({
        angle: angle.label,
        zone: zone.label,
        code: c?.code ?? "",
        nameJa: c?.nameJa ?? "",
        category: c?.category ?? "",
        opacity: zone.opacity,
        sandstone: zone.finishTexture === "sandstone" ? "有" : "無",
        swatchUrl: c?.swatchUrl ?? null,
      });
    }
  }
  return rows;
}

async function fetchPngBytes(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

/**
 * Build the exterior spec workbook: a `塗り分け` sheet of every zone across
 * every angle, and an `その他外装` sheet of the recorded prompts.
 */
export async function buildExteriorSpecSheetBlob(
  project: ExteriorProject,
  colors: ReadonlyArray<JolypateColor>,
): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();

  const ws = workbook.addWorksheet("塗り分け");
  ws.columns = [
    { header: "アングル", key: "angle", width: 18 },
    { header: "ゾーン", key: "zone", width: 20 },
    { header: "色番", key: "code", width: 12 },
    { header: "色名", key: "nameJa", width: 14 },
    { header: "カテゴリ", key: "category", width: 12 },
    { header: "不透明度", key: "opacity", width: 10 },
    { header: "砂岩仕上げ", key: "sandstone", width: 11 },
    { header: "スウォッチ", key: "swatch", width: 12 },
  ];
  ws.getRow(1).font = { bold: true };

  const rows = buildSpecRows(project, colors);
  // Cache swatch bytes: many zones share a colour, and each addImage would
  // otherwise refetch and re-embed the same tile.
  const imageIds = new Map<string, number>();

  for (const r of rows) {
    const row = ws.addRow({
      angle: r.angle,
      zone: r.zone,
      code: r.code,
      nameJa: r.nameJa,
      category: r.category,
      opacity: r.opacity,
      sandstone: r.sandstone,
    });
    row.height = 22;
    if (!r.swatchUrl) continue;
    let id = imageIds.get(r.swatchUrl);
    if (id === undefined) {
      const bytes = await fetchPngBytes(r.swatchUrl);
      if (!bytes) continue;
      id = workbook.addImage({ buffer: bytes as ArrayBuffer, extension: "png" });
      imageIds.set(r.swatchUrl, id);
    }
    ws.addImage(id, {
      tl: { col: 7.1, row: row.number - 0.9 },
      ext: { width: 26, height: 26 },
    });
  }

  const extrasSheet = workbook.addWorksheet("その他外装");
  extrasSheet.columns = [
    { header: "カテゴリ", key: "category", width: 16 },
    { header: "指定内容", key: "prompt", width: 70 },
    { header: "更新日時", key: "updatedAt", width: 22 },
  ];
  extrasSheet.getRow(1).font = { bold: true };
  for (const category of EXTRAS_CATEGORIES) {
    const e = project.extras.find((x) => x.category === category);
    // Empty categories are omitted rather than exported as blank rows.
    if (!e || !e.prompt.trim()) continue;
    extrasSheet.addRow({
      category,
      prompt: e.prompt,
      updatedAt: e.updatedAt ? new Date(e.updatedAt).toLocaleString("ja-JP") : "",
    });
  }
  extrasSheet.getColumn("prompt").alignment = { wrapText: true, vertical: "top" };

  const buf = await workbook.xlsx.writeBuffer();
  return new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** Deliver a set of already-built files, PNGs first. */
export async function deliverExteriorExport(
  files: Array<{ blob: Blob; filename: string }>,
): Promise<void> {
  await downloadBlobsSequentially(files);
}

// -------------------------------------------------------- project JSON I/O

export const PROJECT_JSON_VERSION = 1;

/**
 * Serialize a project without its image binaries.
 *
 * IndexedDB is cleared by a browser cache purge, an incognito window, or a
 * new machine, so there has to be a way out. Images are excluded because two
 * 4000 px JPEGs base64 into a JSON file too large to be useful; re-import
 * asks for the original files instead and checks their dimensions.
 */
export function serializeProject(project: ExteriorProject): string {
  return JSON.stringify(
    {
      version: PROJECT_JSON_VERSION,
      kind: "specdrawing-exterior-project",
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      angles: project.angles.map((a) => ({
        label: a.label,
        filename: a.filename,
        width: a.width,
        height: a.height,
        zones: a.zones,
      })),
      extras: project.extras,
    },
    null,
    2,
  );
}

export function projectJsonFilename(projectName: string): string {
  return `${slugify(projectName)}.specdrawing-ext.json`;
}
