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

export const partsManifestSchema = z.object({
  version: z.literal(1),
  parts: z.array(partSchema),
});

export type RawPartsManifest = z.infer<typeof partsManifestSchema>;
export type PartsManifest = Omit<RawPartsManifest, "parts"> & {
  parts: Part[];
};
