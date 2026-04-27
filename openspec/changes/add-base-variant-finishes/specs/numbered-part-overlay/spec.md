## MODIFIED Requirements

### Requirement: Numbered-part manifest per scene
Each registered base perspective MUST be accompanied by a numbered-part manifest at `public/assets/base/<scene-id>/parts.json`, validated against a Zod schema at load time. The manifest SHALL enumerate every changeable region of the perspective as a part record containing: a stable string id (zero-padded, e.g. `"01"` … `"17"`), a Japanese label, a category, the source-PDF reference (1, 2, or 3, matching `部材対応番号-<n>.pdf`), the marker centroid in scene-pixel coordinates, a polygon (ordered list of `[x, y]` vertices in scene-pixel coordinates) for hit-testing, the declared render mode (`"color"` or `"texture"`), and the mask filename relative to the scene directory. Color-mode parts MUST additionally declare a shading filename. Texture-mode parts MUST NOT declare a shading filename (the field is rejected by the schema).

⑫ 玄関床 SHALL be declared with `renderMode: "texture"` so its three options (ｸﾚﾏﾌﾞﾛｯｸ / ｵﾝﾌﾀﾞｶﾞﾀﾗｲﾄ / ﾜｲﾄﾞﾓﾙﾀﾙ) can be served via base-variant cropped pieces (per `finish-spec-catalog`'s per-option base-variant override config). The previous `shading` field on ⑫ is removed.

#### Scenario: Parts manifest loads and validates
- **WHEN** a scene is loaded and its `parts.json` passes Zod validation
- **THEN** every part is available to the canvas overlay and to the `finish-spec-catalog` lookup

#### Scenario: Color-mode part missing shading rejected
- **WHEN** a part declares `renderMode: "color"` but omits the `shading` field
- **THEN** validation fails at load time with an error naming the offending part id

#### Scenario: Texture-mode part with a shading field rejected
- **WHEN** a part declares `renderMode: "texture"` but also includes a `shading` field
- **THEN** validation fails at load time with an error naming the offending part id

#### Scenario: Mask asset missing fails visibly
- **WHEN** a part declares `mask: "mask_07.png"` but the file is absent under the scene directory
- **THEN** the loader surfaces an error naming the scene, the part id, and the missing file
