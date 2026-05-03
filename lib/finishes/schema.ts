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
    /**
     * Optional secondary description from the workbook sub-row (e.g. ②
     * "電球色" / "光無し"). Distinct from `label`, which is the primary
     * option name shown in the side-panel chips.
     */
    subLabel: z.string().min(1).optional(),
    productCode: z.string().optional(),
    thumbnailUrl: z.string().min(1),
    /**
     * Square icon image (≥ 96 px) used by the Excel spec-sheet export.
     * Distinct from `thumbnailUrl`, which is sized for the on-canvas swatch.
     * Falls back to `thumbnailUrl` at export time when absent.
     */
    iconUrl: z.string().min(1).optional(),
    /**
     * Variant keys for which this option is the customer-facing default
     * (auto-displayed before any manual selection on that variant). Empty
     * array means the option is an "alternative" (only displayed when the
     * customer actively picks it). Populated by the seed pipeline from
     * the workbook's Natural / Flat / Sharp columns.
     */
    defaultForVariants: z.array(z.string().min(1)).default([]),
    colorHex: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, "colorHex must be #RRGGBB")
      .optional(),
    /**
     * Per-variant override of `colorHex` for color-mode options on a
     * variant-enabled sheet. When the active variant key has an entry,
     * the runtime composes that hex; otherwise it falls back to `colorHex`.
     * Keys MUST match a `key` declared on the active scene's `variants[]`
     * (validated by `crossValidateColorHexByVariantAgainstScene`). MUST NOT
     * be set on texture-mode options.
     */
    colorHexByVariant: z
      .record(
        z.string().min(1),
        z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/, "colorHexByVariant value must be #RRGGBB"),
      )
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
    /**
     * Marker set by the seed pipeline when an option was created by
     * cross-sheet synthesis (e.g. アーバンシー ⑭ ブラック copied from レコリード
     * because a variant-mapping override referenced a label not present on
     * the primary sheet). Purely informational; runtime ignores it.
     */
    synthesized: z.boolean().optional(),
  })
  .refine(
    (o) => Boolean(o.colorHex) !== Boolean(o.textureUrl),
    {
      message:
        "exactly one of colorHex / textureUrl must be set (xor)",
      path: ["colorHex"],
    },
  )
  .refine(
    (o) => !(o.textureUrl && o.colorHexByVariant),
    {
      message:
        "colorHexByVariant must not be set on texture-mode options",
      path: ["colorHexByVariant"],
    },
  );

export type FinishOption = z.infer<typeof finishOptionSchema>;
export type FinishOptionId = string;

export const finishOptionsFileSchema = z.object({
  version: z.literal(1),
  options: z.array(finishOptionSchema),
});

export type FinishOptionsFile = z.infer<typeof finishOptionsFileSchema>;

// ----- finish-variant-mapping.json -----
//
// Designer-editable seed-time override. Three independent blocks:
//   - overrides: re-assign which option claims each (partId, variantKey).
//   - noEffect: list of (partId, optionLabel) pairs that should render as
//     an ambient-fill (e.g. ② キッチン間接照明 "無" erases the lighting bloom).
//   - colorHexByVariant: per-(partId, optionLabel, variantKey) #RRGGBB
//     overrides for color-mode options. Materializes into the option's
//     `colorHexByVariant` field by the seed pipeline.

export const variantMappingOverridesSchema = z.record(
  z.string().regex(/^\d{2}$/),
  z.record(z.string().min(1), z.string().min(1)),
);

export const variantMappingNoEffectSchema = z.array(
  z.object({
    partId: z.string().regex(/^\d{2}$/),
    optionLabel: z.string().min(1),
    /**
     * Distance (px) outside the part mask used to sample the ambient
     * "neighborhood ring". Default 16. Increase (e.g. 64-100) when the
     * effect being erased has a soft halo extending beyond the polygon
     * (② indirect-lighting bloom): a small ring picks up the halo and
     * leaves the part visually identical to its lit surroundings.
     */
    dilate: z.number().int().min(1).max(256).default(16).optional(),
    /**
     * Multiplier applied to the sampled ring color before writing the
     * fill PNG. 1.0 = no dim, 0.5 = halve brightness, etc. Use < 1 when
     * the ring sample is too close to the lit area to read as "off".
     */
    dim: z.number().min(0).max(2).default(1).optional(),
    /**
     * When set, overrides the ring sample entirely with this `#RRGGBB`
     * value. Lets the designer hand-pick an "un-lit" reference color
     * when sampling produces an unsatisfying result.
     */
    targetHex: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
  }),
);

export const variantMappingColorHexByVariantSchema = z.record(
  z.string().regex(/^\d{2}$/),
  z.record(
    z.string().min(1),
    z.record(
      z.string().min(1),
      z.string().regex(/^#[0-9a-fA-F]{6}$/),
    ),
  ),
);

export const variantMappingSchema = z.object({
  version: z.literal(1),
  overrides: variantMappingOverridesSchema.optional(),
  noEffect: variantMappingNoEffectSchema.optional(),
  colorHexByVariant: variantMappingColorHexByVariantSchema.optional(),
});

export type VariantMapping = z.infer<typeof variantMappingSchema>;

// ----- finish-base-overrides.json (extended) -----
//
// Existing `overrides` block stays. Adds an optional `tintBase` block:
// per-part declaration of the option whose monotone luminance is used as
// the tint pattern for every alternative on that part.

export const tintBasePartSchema = z.object({
  /**
   * Texture-mode tint base: the option whose masked variant crop is used
   * as the luminance source for tinting alternative options on the same
   * part. OMIT for color-mode parts — see `lift` below.
   */
  label: z.string().min(1).optional(),
  /**
   * 0 = pure multiply (full grain contrast, dark bands crush light icon
   * colors toward black); 1 = no shading at all (flat icon color, no
   * grain). Typical values: 0.4–0.6 for wood-grain doors / panels where
   * dark grain otherwise overwhelms white/ivory swatches; 0.1–0.2 for
   * floors where the grain is subtler. The lift is applied as
   * `Y' = Y + (1 - Y) * lift` before the multiply.
   *
   * For COLOR-MODE parts (no `label`): the lift is applied to the part's
   * `shading_<id>.png` file in-place during `seed:variants`, suppressing
   * dark shading bands so light `colorHex` values don't read as gray.
   */
  lift: z.number().min(0).max(1).default(0),
});

export const tintBaseSchema = z.record(
  z.string().regex(/^\d{2}$/),
  tintBasePartSchema,
);

export const finishBaseOverridesSchema = z.object({
  version: z.literal(1),
  overrides: z.record(
    z.string().regex(/^\d{2}$/),
    z.record(z.string().min(1), z.string().min(1)),
  ).optional(),
  tintBase: tintBaseSchema.optional(),
});

export type FinishBaseOverrides = z.infer<typeof finishBaseOverridesSchema>;
