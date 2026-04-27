import { z } from "zod";

export const sceneSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  baseImageUrl: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  partsManifestUrl: z.string().min(1),
});

export type Scene = z.infer<typeof sceneSchema>;

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
