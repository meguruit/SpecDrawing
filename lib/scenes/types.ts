import { z } from "zod";

export const scenePartSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  maskUrl: z.string().min(1),
  shadingUrl: z.string().min(1),
});

export type ScenePart = z.infer<typeof scenePartSchema>;

export const sceneSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  baseImageUrl: z.string().min(1),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  parts: z.array(scenePartSchema),
});

export type Scene = z.infer<typeof sceneSchema>;

export const scenesIndexSchema = z.object({
  version: z.literal(1),
  scenes: z.array(
    z.object({
      id: z.string().min(1),
      name: z.string().min(1),
      manifestUrl: z.string().min(1),
    }),
  ),
});

export type ScenesIndex = z.infer<typeof scenesIndexSchema>;
