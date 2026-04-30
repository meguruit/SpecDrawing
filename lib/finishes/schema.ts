import { z } from "zod";

export const sheetNameSchema = z.string().min(1);
export type SheetName = z.infer<typeof sheetNameSchema>;

export const sheetConfigSchema = z
  .object({
    key: sheetNameSchema,
    label: z.string().min(1),
    variantsEnabled: z.boolean(),
    defaultVariantKey: z.string().min(1).optional(),
  })
  .superRefine((s, ctx) => {
    if (s.variantsEnabled && !s.defaultVariantKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["defaultVariantKey"],
        message: `sheet "${s.key}" has variantsEnabled: true but no defaultVariantKey`,
      });
    }
  });

export type SheetConfig = z.infer<typeof sheetConfigSchema>;

export const sheetsManifestSchema = z
  .object({
    version: z.literal(1),
    sheets: z.array(sheetConfigSchema).min(1),
  })
  .superRefine((m, ctx) => {
    const seen = new Set<string>();
    for (const s of m.sheets) {
      if (seen.has(s.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["sheets"],
          message: `duplicate sheet key "${s.key}"`,
        });
      }
      seen.add(s.key);
    }
  });

export type SheetsManifest = z.infer<typeof sheetsManifestSchema>;

export const textureBoxSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export type TextureBox = z.infer<typeof textureBoxSchema>;

export const variantTextureEntrySchema = z.object({
  url: z.string().min(1),
  textureBox: textureBoxSchema.optional(),
});

export type VariantTextureEntry = z.infer<typeof variantTextureEntrySchema>;

export const finishOptionSchema = z
  .object({
    id: z.string().min(1),
    partId: z.string().regex(/^\d{2}$/),
    sheet: sheetNameSchema,
    label: z.string().min(1),
    productCode: z.string().optional(),
    thumbnailUrl: z.string().min(1),
    /**
     * Square icon image (≥ 96 px) used by the Excel spec-sheet export.
     * Distinct from `thumbnailUrl`, which is sized for the on-canvas swatch.
     * Falls back to `thumbnailUrl` at export time when absent.
     */
    iconUrl: z.string().min(1).optional(),
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
    /**
     * For texture-mode options on a sheet with `variantsEnabled === true`,
     * one entry per declared scene variant key. Each entry holds the URL
     * of the variant-specific cropped PNG plus an optional `textureBox`
     * (so seed time can ship bbox-cropped pieces, like `_v_<variant>.png`).
     * Required by the cross-validator when the option's sheet enables
     * variants; optional otherwise.
     */
    textureUrlByVariant: z
      .record(z.string().min(1), variantTextureEntrySchema)
      .optional(),
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
