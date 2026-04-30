import { z } from "zod";

export const sceneVariantSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  baseImageUrl: z.string().min(1),
});

export type SceneVariant = z.infer<typeof sceneVariantSchema>;

export const sceneSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    baseImageUrl: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    partsManifestUrl: z.string().min(1),
    variants: z.array(sceneVariantSchema).default([]),
  })
  .superRefine((s, ctx) => {
    const keys = new Set<string>();
    for (const v of s.variants) {
      if (keys.has(v.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["variants"],
          message: `duplicate variant key "${v.key}"`,
        });
      }
      keys.add(v.key);
    }
    if (s.variants.length > 0) {
      const matchesDefault = s.variants.some(
        (v) => v.baseImageUrl === s.baseImageUrl,
      );
      if (!matchesDefault) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["variants"],
          message:
            "when variants is non-empty, exactly one entry's baseImageUrl must match the scene's top-level baseImageUrl",
        });
      }
    }
  });

export type Scene = z.infer<typeof sceneSchema>;

export function defaultVariantKey(scene: Scene): string | null {
  if (scene.variants.length === 0) return null;
  const match = scene.variants.find((v) => v.baseImageUrl === scene.baseImageUrl);
  return match?.key ?? null;
}

export const sceneIndexEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  manifestUrl: z.string().min(1),
  default: z.boolean().optional(),
});

export type SceneIndexEntry = z.infer<typeof sceneIndexEntrySchema>;

export const scenesIndexSchema = z
  .object({
    version: z.literal(1),
    scenes: z.array(sceneIndexEntrySchema).min(1),
  })
  .refine(
    (idx) => idx.scenes.filter((s) => s.default === true).length === 1,
    { message: "exactly one scene must be marked default: true" },
  );

export type ScenesIndex = z.infer<typeof scenesIndexSchema>;
