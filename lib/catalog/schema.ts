import { z } from "zod";

export const KNOWN_AXES = [
  "series",
  "design",
  "color",
  "width",
  "height",
  "openingType",
  "mirror",
  "type",
] as const;

export type KnownAxisKey = (typeof KNOWN_AXES)[number];

const axisValueSchema = z.string().min(1);

export const materialEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  thumbnailUrl: z.string().min(1),
  placementImageUrl: z.string().min(1),
  axes: z.record(axisValueSchema),
});

export type MaterialEntry = z.infer<typeof materialEntrySchema>;

export const materialCatalogSchema = z
  .object({
    version: z.literal(1),
    entries: z.array(materialEntrySchema),
  })
  .superRefine((catalog, ctx) => {
    const seen = new Map<string, number>();
    catalog.entries.forEach((entry, index) => {
      const prev = seen.get(entry.id);
      if (prev !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entries", index, "id"],
          message: `Duplicate id "${entry.id}" (also at index ${prev})`,
        });
      } else {
        seen.set(entry.id, index);
      }
    });
  });

export type MaterialCatalog = z.infer<typeof materialCatalogSchema>;

export function isKnownAxis(key: string): key is KnownAxisKey {
  return (KNOWN_AXES as readonly string[]).includes(key);
}
