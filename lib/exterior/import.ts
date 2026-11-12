import { z } from "zod";

import { facadeZoneSchema, extrasBriefSchema, emptyExtras, newId } from "./types";
import type { ExteriorProject, StoredImage } from "./types";
import { PROJECT_JSON_VERSION } from "./export";
import { readImageSize } from "./image";
import * as db from "./db";

// Re-import of a project JSON exported by `serializeProject`.
//
// The JSON carries no image bytes, so import is two-phase: parse the file to
// learn which images it needs, then have the user re-attach each one. An
// image whose dimensions differ from the recorded ones is refused — zone
// coordinates are in image pixel space, so a differently-sized file would
// silently misplace every zone.

export class ProjectImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectImportError";
  }
}

const importedAngleSchema = z.object({
  label: z.string().min(1),
  filename: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  zones: z.array(facadeZoneSchema),
});

const projectFileSchema = z.object({
  version: z.literal(PROJECT_JSON_VERSION),
  kind: z.literal("specdrawing-exterior-project"),
  name: z.string().min(1),
  createdAt: z.number().int().nonnegative().optional(),
  updatedAt: z.number().int().nonnegative().optional(),
  angles: z.array(importedAngleSchema),
  extras: z.array(extrasBriefSchema).optional(),
});

export type ParsedProjectFile = z.infer<typeof projectFileSchema>;

/** Parse and validate an exported project file. */
export function parseProjectFile(text: string): ParsedProjectFile {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new ProjectImportError(`JSON として読み込めません: ${(err as Error).message}`);
  }
  const result = projectFileSchema.safeParse(json);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ProjectImportError(
      `案件ファイルの形式が不正です: ${issue.path.join(".") || "(ルート)"}: ${issue.message}`,
    );
  }
  return result.data;
}

/**
 * Check a re-attached file against the dimensions the export recorded.
 *
 * Refusing a mismatch is the whole point: zone geometry is in the stored
 * image's pixel space, so attaching a resized copy would move every zone
 * without any visible error.
 */
export async function verifyAttachment(
  file: File,
  expected: { width: number; height: number; label: string },
): Promise<{ width: number; height: number }> {
  const size = await readImageSize(file);
  if (size.width !== expected.width || size.height !== expected.height) {
    throw new ProjectImportError(
      `アングル「${expected.label}」の画像サイズが一致しません。` +
        `期待 ${expected.width}×${expected.height}、選択されたファイルは ${size.width}×${size.height} です。` +
        `ゾーン座標は画像のピクセル座標系なので、寸法が違うとゾーンがずれます。`,
    );
  }
  return size;
}

/**
 * Build and persist a project from a parsed file plus its re-attached images.
 *
 * `attachments` is keyed by angle label. Every angle must have one — a
 * partially attached import would produce angles that render nothing.
 */
export async function importProject(
  parsed: ParsedProjectFile,
  attachments: Map<string, File>,
  now: number,
): Promise<ExteriorProject> {
  const missing = parsed.angles.filter((a) => !attachments.has(a.label));
  if (missing.length > 0) {
    throw new ProjectImportError(
      `画像が未添付のアングルがあります: ${missing.map((a) => a.label).join(", ")}`,
    );
  }

  const angles: ExteriorProject["angles"] = [];
  for (const a of parsed.angles) {
    const file = attachments.get(a.label)!;
    await verifyAttachment(file, { width: a.width, height: a.height, label: a.label });
    const image: StoredImage = {
      id: newId("img"),
      blob: file,
      filename: a.filename,
      width: a.width,
      height: a.height,
      byteSize: file.size,
    };
    await db.putImage(image);
    angles.push({
      id: newId("ang"),
      label: a.label,
      imageId: image.id,
      filename: a.filename,
      width: a.width,
      height: a.height,
      zones: a.zones,
    });
  }

  const project: ExteriorProject = {
    id: newId("prj"),
    name: parsed.name,
    createdAt: parsed.createdAt ?? now,
    updatedAt: now,
    angles,
    extras: parsed.extras?.length ? parsed.extras : emptyExtras(),
  };
  await db.putProject(project);
  return project;
}
