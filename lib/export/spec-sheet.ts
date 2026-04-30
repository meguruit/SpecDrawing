// Dynamic-imported Excel spec-sheet builder. Stays out of the main bundle
// until the user actually clicks export, since `exceljs` adds ~200 KB gzipped.

import type { Part, PartId } from "@/lib/parts/types";
import type { FinishOption, SheetName } from "@/lib/finishes/schema";

export type SelectionState = "選択" | "既定" | "対象外";

export type SpecSheetRow = {
  partId: PartId;
  partLabel: string;
  category: string;
  optionLabel: string;
  productCode: string;
  iconUrl: string | null;
  state: SelectionState;
};

export function buildSpecSheetRows(args: {
  parts: Part[];
  finishOptions: FinishOption[];
  selections: Record<PartId, string>;
  activeSheet: SheetName;
  optionsRev?: string;
}): SpecSheetRow[] {
  const { parts, finishOptions, selections, activeSheet, optionsRev } = args;
  const bust = (url: string | null | undefined) => {
    if (!url) return null;
    if (!optionsRev) return url;
    return `${url}?v=${optionsRev}`;
  };
  const sortedParts = [...parts].sort((a, b) => a.id.localeCompare(b.id));
  const rows: SpecSheetRow[] = [];
  for (const part of sortedParts) {
    const sheetOptions = finishOptions.filter(
      (o) => o.partId === part.id && o.sheet === activeSheet,
    );
    let pickedOptionId: string | undefined = selections[part.id];
    let state: SelectionState = "選択";
    if (!pickedOptionId) {
      pickedOptionId = sheetOptions[0]?.id;
      state = pickedOptionId ? "既定" : "対象外";
    }
    if (state === "対象外" || !pickedOptionId) {
      rows.push({
        partId: part.id,
        partLabel: part.label,
        category: part.category,
        optionLabel: "",
        productCode: "",
        iconUrl: null,
        state: "対象外",
      });
      continue;
    }
    const opt = finishOptions.find((o) => o.id === pickedOptionId);
    if (!opt) {
      rows.push({
        partId: part.id,
        partLabel: part.label,
        category: part.category,
        optionLabel: "",
        productCode: "",
        iconUrl: null,
        state: "対象外",
      });
      continue;
    }
    rows.push({
      partId: part.id,
      partLabel: part.label,
      category: part.category,
      optionLabel: opt.label,
      productCode: opt.productCode ?? "",
      // Fall back to thumbnailUrl when iconUrl is absent. The seed pipeline
      // is expected to populate iconUrl going forward; the fallback keeps
      // the export functional during the migration.
      iconUrl: bust(opt.iconUrl ?? opt.thumbnailUrl ?? null),
      state,
    });
  }
  return rows;
}

async function fetchAsArrayBuffer(url: string): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

const HEADERS = ["番号", "部位", "カテゴリ", "部材名", "製品型番", "アイコン", "選択状態"] as const;
const ICON_PIXELS = 64;

export async function buildSpecSheetWorkbook(args: {
  parts: Part[];
  finishOptions: FinishOption[];
  selections: Record<PartId, string>;
  activeSheet: SheetName;
  optionsRev?: string;
}): Promise<{ workbook: import("exceljs").Workbook; rows: SpecSheetRow[] }> {
  const { default: ExcelJS } = await import("exceljs");
  const rows = buildSpecSheetRows(args);
  const wb = new ExcelJS.Workbook();
  wb.creator = "SpecDrawing";
  wb.created = new Date();
  const ws = wb.addWorksheet("選択部材", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  ws.columns = [
    { header: HEADERS[0], key: "partId", width: 6 },
    { header: HEADERS[1], key: "partLabel", width: 24 },
    { header: HEADERS[2], key: "category", width: 12 },
    { header: HEADERS[3], key: "optionLabel", width: 28 },
    { header: HEADERS[4], key: "productCode", width: 18 },
    { header: HEADERS[5], key: "iconUrl", width: 12 },
    { header: HEADERS[6], key: "state", width: 10 },
  ];
  ws.getRow(1).font = { bold: true };

  for (const row of rows) {
    const r = ws.addRow({
      partId: row.partId,
      partLabel: row.partLabel,
      category: row.category,
      optionLabel: row.optionLabel,
      productCode: row.productCode,
      iconUrl: "",
      state: row.state,
    });
    r.height = 56;
  }

  // Embed images. ExcelJS image addresses use 0-indexed cells.
  // Header is row 0, so the first data row starts at row 1.
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.iconUrl) continue;
    const buf = await fetchAsArrayBuffer(row.iconUrl);
    if (!buf) continue;
    const ext = row.iconUrl.toLowerCase().endsWith(".jpg") || row.iconUrl.toLowerCase().endsWith(".jpeg")
      ? "jpeg"
      : "png";
    const imageId = wb.addImage({ buffer: buf, extension: ext as "png" | "jpeg" });
    ws.addImage(imageId, {
      tl: { col: 5.1, row: i + 1 + 0.1 },
      ext: { width: ICON_PIXELS, height: ICON_PIXELS },
      editAs: "oneCell",
    });
  }

  return { workbook: wb, rows };
}

export async function downloadSpecSheet(args: {
  parts: Part[];
  finishOptions: FinishOption[];
  selections: Record<PartId, string>;
  activeSheet: SheetName;
  filename: string;
  optionsRev?: string;
}): Promise<void> {
  const { workbook } = await buildSpecSheetWorkbook(args);
  const buf = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = args.filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
