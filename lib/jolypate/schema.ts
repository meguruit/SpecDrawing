import { z } from "zod";

// Schema for `public/catalog/jolypate-colors.json`, produced by
// `npm run seed:jolypate` from the AICA JOLYPATE colour table PDF.
//
// The catalogue holds only the orderable, tintable colours — the ones printed
// on a yellow highlight band. Non-tintable and special-order entries are
// excluded by the seed and listed in the companion warnings file, so anything
// absent here is absent on purpose.

export const jolypateCategorySchema = z.enum([
  "NEUTRAL",
  "MISTY",
  "SUNNY",
  "TRAD",
]);
export type JolypateCategory = z.infer<typeof jolypateCategorySchema>;

/** Display order in the picker; matches the printed catalogue's order. */
export const JOLYPATE_CATEGORY_ORDER: JolypateCategory[] = [
  "NEUTRAL",
  "MISTY",
  "SUNNY",
  "TRAD",
];

export const jolypateColorSchema = z.object({
  /** Catalogue colour number, e.g. `T1403`. Unique across the catalogue. */
  code: z.string().min(1),
  category: jolypateCategorySchema,
  /** 1-based page of the source PDF the colour was read from. */
  page: z.number().int().positive(),
  /**
   * Representative colour of the printed swatch, as a trimmed mean of its
   * pixels. Jolypate finishes are aggregate-bearing, so this is the field
   * colour a person sees rather than any single pixel.
   */
  colorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/, "colorHex must be #RRGGBB"),
  /**
   * Japanese colour name, where the catalogue gives one (the TRAD colours are
   * named, e.g. 白練). Optional: the source PDF prints these as vector
   * outlines with no text layer, so they arrive only via the designer
   * override file.
   */
  nameJa: z.string().min(1).optional(),
  /** Flat tile of `colorHex`, used by the picker chips and the spec sheet. */
  swatchUrl: z.string().min(1),
});

export type JolypateColor = z.infer<typeof jolypateColorSchema>;

export const jolypateCatalogSchema = z.object({
  version: z.literal(1),
  generatedFrom: z.string().min(1),
  colors: z.array(jolypateColorSchema).min(1),
});

export type JolypateCatalog = z.infer<typeof jolypateCatalogSchema>;
