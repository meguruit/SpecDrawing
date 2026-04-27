import { z } from "zod";

export const partRenderModeSchema = z.enum(["color", "texture"]);
export type PartRenderMode = z.infer<typeof partRenderModeSchema>;

const point2 = z.tuple([z.number(), z.number()]);

export const partSchema = z
  .object({
    id: z.string().regex(/^\d{2}$/, "part id must be two digits, e.g. \"07\""),
    label: z.string().min(1),
    category: z.string().min(1),
    sourcePdf: z.union([z.literal(1), z.literal(2), z.literal(3)]),
    marker: z.object({ x: z.number(), y: z.number() }),
    polygon: z.array(point2).min(3),
    renderMode: partRenderModeSchema,
    mask: z.string().min(1),
    shading: z.string().min(1).optional(),
  })
  .refine(
    (p) => (p.renderMode === "color" ? typeof p.shading === "string" : true),
    { message: "color-mode parts must declare shading", path: ["shading"] },
  );

export type Part = z.infer<typeof partSchema>;
export type PartId = string;

export const partsManifestSchema = z.object({
  version: z.literal(1),
  parts: z.array(partSchema),
});

export type PartsManifest = z.infer<typeof partsManifestSchema>;
