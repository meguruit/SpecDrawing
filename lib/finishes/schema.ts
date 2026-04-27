import { z } from "zod";

export const sheetNameSchema = z.string().min(1);
export type SheetName = z.infer<typeof sheetNameSchema>;

export const textureBoxSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export type TextureBox = z.infer<typeof textureBoxSchema>;

export const finishOptionSchema = z
  .object({
    id: z.string().min(1),
    partId: z.string().regex(/^\d{2}$/),
    sheet: sheetNameSchema,
    label: z.string().min(1),
    productCode: z.string().optional(),
    thumbnailUrl: z.string().min(1),
    colorHex: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "colorHex must be #RRGGBB")
      .optional(),
    textureUrl: z.string().min(1).optional(),
    /**
     * When set, the runtime paints `textureUrl` at (x, y) with the given
     * width/height in scene coords (instead of the default full-scene
     * paint at (0, 0) × scene dimensions). Used by base-variant cuts that
     * are bbox-cropped at seed time to keep file sizes tractable.
     */
    textureBox: textureBoxSchema.optional(),
  })
  .refine(
    (o) => Boolean(o.colorHex) !== Boolean(o.textureUrl),
    {
      message:
        "exactly one of colorHex / textureUrl must be set (xor)",
      path: ["colorHex"],
    },
  );

export type FinishOption = z.infer<typeof finishOptionSchema>;
export type FinishOptionId = string;

export const finishOptionsFileSchema = z.object({
  version: z.literal(1),
  options: z.array(finishOptionSchema),
});

export type FinishOptionsFile = z.infer<typeof finishOptionsFileSchema>;
