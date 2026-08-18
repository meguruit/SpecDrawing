import { z } from "zod";

import { polygonSchema, type Polygon } from "@/lib/parts/types";

// Data model for exterior facade colour-zoning projects.
//
// Unlike the interior presenter — whose scenes, parts and masks are committed
// assets shared by every job — an exterior perspective is a one-off per
// project. Everything here is authored in the browser and persisted there;
// nothing is seeded, and nothing is sent to a server.

/**
 * Other-exterior categories. Fixed set: this change records specifications,
 * it does not let users invent new ones.
 */
export const EXTRAS_CATEGORIES = [
  "ライティング",
  "アクセント",
  "館銘サイン",
  "ポスト",
  "外構-緑化",
  "外構-舗装",
  "門扉",
] as const;

export const extrasCategorySchema = z.enum(EXTRAS_CATEGORIES);
export type ExtrasCategory = z.infer<typeof extrasCategorySchema>;

/** Finish texture applied over a zone's colour. Extensible; one option today. */
export const finishTextureSchema = z.enum(["sandstone"]);
export type FinishTexture = z.infer<typeof finishTextureSchema>;

/** Opacity a new zone starts at — see design D5. */
export const DEFAULT_ZONE_OPACITY = 0.85;

/** Cap on stored image size; larger uploads are downscaled to this on ingest. */
export const MAX_IMAGE_EDGE = 4000;

export const facadeZoneSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  /**
   * Multi-ring geometry in the angle image's pixel coordinates. Reuses the
   * parts manifest's shape so the shared polygon editor, hit-test and ring
   * operations all apply unchanged.
   */
  polygons: z.array(polygonSchema).min(1),
  /** Jolypate catalogue colour number, or null while unassigned. */
  colorCode: z.string().min(1).nullable(),
  opacity: z.number().min(0).max(1),
  finishTexture: finishTextureSchema.nullable(),
});

export type FacadeZone = z.infer<typeof facadeZoneSchema>;

export const exteriorAngleSchema = z.object({
  id: z.string().min(1),
  /** User-facing name; also the filename slug on export. */
  label: z.string().min(1),
  /** Key into the `images` object store. Absent from the JSON export. */
  imageId: z.string().min(1),
  /** Original upload filename, kept so a JSON re-import can ask for it by name. */
  filename: z.string().min(1),
  /**
   * Stored image dimensions. Zone coordinates live in this space, so a
   * re-imported image whose dimensions differ must be rejected.
   */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Composited back-to-front: later zones draw over earlier ones. */
  zones: z.array(facadeZoneSchema),
});

export type ExteriorAngle = z.infer<typeof exteriorAngleSchema>;

export const extrasBriefSchema = z.object({
  category: extrasCategorySchema,
  prompt: z.string(),
  updatedAt: z.number().int().nonnegative(),
});

export type ExtrasBrief = z.infer<typeof extrasBriefSchema>;

export const exteriorProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  angles: z.array(exteriorAngleSchema),
  /** Scoped to the project, not to an angle. */
  extras: z.array(extrasBriefSchema),
});

export type ExteriorProject = z.infer<typeof exteriorProjectSchema>;

/** Stored image record. The blob is held separately from the project record. */
export type StoredImage = {
  id: string;
  blob: Blob;
  filename: string;
  width: number;
  height: number;
  byteSize: number;
};

// ------------------------------------------------------------------ helpers

export function newId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  return `${prefix}_${rand}`;
}

export function emptyExtras(): ExtrasBrief[] {
  return EXTRAS_CATEGORIES.map((category) => ({
    category,
    prompt: "",
    updatedAt: 0,
  }));
}

export function createProject(name: string, now: number): ExteriorProject {
  return {
    id: newId("prj"),
    name,
    createdAt: now,
    updatedAt: now,
    angles: [],
    extras: emptyExtras(),
  };
}

export function createZone(index: number, polygons: Polygon[]): FacadeZone {
  return {
    id: newId("zone"),
    label: `ゾーン${index + 1}`,
    polygons,
    colorCode: null,
    opacity: DEFAULT_ZONE_OPACITY,
    finishTexture: null,
  };
}

/**
 * Filesystem-safe slug for export filenames. Keeps Japanese characters —
 * they are legal in filenames on every platform we target and the customer
 * recognises the project by them — and replaces only what would break a path.
 */
export function slugify(input: string): string {
  const cleaned = input
    .trim()
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "untitled";
}
