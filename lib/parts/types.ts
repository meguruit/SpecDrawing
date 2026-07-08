import { z } from "zod";

export const partRenderModeSchema = z.enum(["color", "texture"]);
export type PartRenderMode = z.infer<typeof partRenderModeSchema>;

const point2 = z.tuple([z.number(), z.number()]);
export type Vertex = [number, number];

const ringSchema = z.array(point2).min(3);
export type Ring = Vertex[];

export const polygonSchema = z.object({
  outer: ringSchema,
  holes: z.array(ringSchema).optional(),
});
export type Polygon = z.infer<typeof polygonSchema>;

export const partSchema = z
  .object({
    id: z.string().regex(/^\d{2}$/, 'part id must be two digits, e.g. "07"'),
    label: z.string().min(1),
    category: z.string().min(1),
    sourcePdf: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    marker: z.object({ x: z.number(), y: z.number() }),
    // Legacy single-polygon shape — accepted for one release, normalized to
    // `polygons` in the loader. Mutually exclusive with `polygons`.
    polygon: ringSchema.optional(),
    // New multi-ring shape. Each entry is `{ outer, holes? }`. At least one
    // entry; outer + each hole both ≥ 3 vertices.
    polygons: z.array(polygonSchema).min(1).optional(),
    renderMode: partRenderModeSchema,
    mask: z.string().min(1),
    shading: z.string().min(1).optional(),
    // Per-variant mask overrides. `maskByVariant[key]` is the mask filename
    // (relative to the scene dir) composited when variant `key` is active;
    // `maskPolygonsByVariant[key]` is the polygon set the regen pipeline
    // rasterizes into that file. Keys MUST match the scene's `scene.json`
    // variants (cross-checked in the loader, where the scene is available).
    // Both optional: a variant without an entry falls back to `mask` /
    // `polygons`. Hit-testing + marker always use the shared `polygons`.
    maskByVariant: z.record(z.string().min(1), z.string().min(1)).optional(),
    maskPolygonsByVariant: z
      .record(z.string().min(1), z.array(polygonSchema).min(1))
      .optional(),
  })
  .superRefine((p, ctx) => {
    const hasLegacy = p.polygon !== undefined;
    const hasNew = p.polygons !== undefined;
    if (hasLegacy && hasNew) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "set exactly one of `polygon` (legacy) or `polygons`, not both",
        path: ["polygons"],
      });
    }
    if (!hasLegacy && !hasNew) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "must set either `polygon` (legacy) or `polygons`",
        path: ["polygons"],
      });
    }
  })
  .refine(
    (p) => (p.renderMode === "color" ? typeof p.shading === "string" : true),
    { message: "color-mode parts must declare shading", path: ["shading"] },
  )
  .refine(
    (p) => (p.renderMode === "texture" ? p.shading === undefined : true),
    {
      message: "texture-mode parts must NOT declare shading",
      path: ["shading"],
    },
  );

// Raw shape coming out of Zod parse — `polygon` and `polygons` are both
// possible (mutually exclusive). Callers should call `normalizePart` to
// collapse to the runtime shape before reading geometry.
export type RawPart = z.infer<typeof partSchema>;

// Runtime shape used by the canvas, rasterizer, hit-test, /dev/trace, etc.
// `polygons` is mandatory; `polygon` does not exist on this type.
export type Part = Omit<RawPart, "polygon" | "polygons"> & {
  polygons: Polygon[];
};

export type PartId = string;

/**
 * Collapse the legacy `polygon: Vertex[]` field to the runtime
 * `polygons: [{ outer }]` shape. Idempotent on already-normalized parts.
 *
 * `onLegacy` lets the caller surface a deprecation signal (the loader
 * passes a `console.warn` in dev mode; the regen route passes a no-op).
 */
export function normalizePart(
  raw: RawPart,
  onLegacy?: (id: string) => void,
): Part {
  if (raw.polygons) {
    const { polygon: _legacy, ...rest } = raw;
    void _legacy;
    return { ...rest, polygons: raw.polygons };
  }
  // hasLegacy is guaranteed by the schema's superRefine.
  if (onLegacy) onLegacy(raw.id);
  const { polygon, ...rest } = raw;
  return { ...rest, polygons: [{ outer: polygon as Vertex[] }] };
}

/**
 * Conventional filename for a part's per-variant mask, derived from its base
 * `mask` by inserting `__<variantKey>` before the extension
 * (e.g. `mask_07.png` + `flat` → `mask_07__flat.png`). Keeps the variant mask
 * adjacent to the base mask regardless of the base naming scheme. Used by
 * /dev/trace when it first creates a `maskByVariant` entry.
 */
export function deriveVariantMaskFilename(
  baseMask: string,
  variantKey: string,
): string {
  const dot = baseMask.lastIndexOf(".");
  if (dot < 0) return `${baseMask}__${variantKey}`;
  return `${baseMask.slice(0, dot)}__${variantKey}${baseMask.slice(dot)}`;
}

export const partsManifestSchema = z.object({
  version: z.literal(1),
  parts: z.array(partSchema),
});

export type RawPartsManifest = z.infer<typeof partsManifestSchema>;
export type PartsManifest = Omit<RawPartsManifest, "parts"> & {
  parts: Part[];
};
