# SpecDrawing — プロダクト全体仕様 + 変更提案サマリ + 工数見積

最終更新: 2026-04-28

このドキュメントは、SpecDrawing（Numbered-Part Finish Picker）の現行仕様を日本語で網羅し、進行中の変更提案 2 件と工数見積を 1 か所に統合したものです。詳細は各 capability の `openspec/specs/<name>/spec.md`、提案は `openspec/changes/<name>/` を参照してください。

---

## 1. プロダクト概要

「登録済みベースパース画像」を背景に、PDF（[部材対応番号-1〜3](../resources/reference/)）で番号付けされた 17 の部材（① 〜 ⑰）を選び、`部材リスト.xlsx` 由来の仕上げ候補を切り替えながら、その場でパース上の見え方を更新するプレゼンテーションボードです。

部材ごとに 2 つのレンダリングモードを持ちます。
- **color** モード — フラットな色バリエーション（壁紙・サッシ枠など）を `mask × shading × color` で合成。
- **texture** モード — 木目や石目のような素材差し替え。事前レンダリング済みの仕上げ画像をマスクでクリップ。

完成像は **PNG エクスポート** で 1 枚画像にできます（ネイティブ解像度 3000×2142、`pixelRatio: 2`）。

### 1.1 主要ユースケース
1. 顧客打合せで、リビング／キッチンのパースを背景にしながら、各部材の仕上げを切替えて見せる。
2. デザイナーが部材ポリゴンを `/dev/trace` で実形状にトレースし、マスクと shading を再生成する。
3. ベース画像のバリエーション（_natural / _sharp / _flat）を「白基調 / 黒基調 / マット」など系統別に用意し、部材の特定オプションだけバリアント側のピクセルへ差し替えて、合成では再現が難しい質感を実現する。
4. 「Export PNG」で打合せ用の最終ボードをダウンロードする。

### 1.2 技術スタック
- **Next.js 14** (App Router, TypeScript) — シングル層、別バックエンドなし。
- **React 18** + **Tailwind CSS**。
- **Konva 9** + **react-konva** — Canvas のレンダラ。`next/dynamic({ ssr: false })` でクライアント側のみ。
- **Zustand** — Canvas state。
- **Zod** — scenes / parts / finish-options の入力スキーマ検証。
- **sharp** / **xlsx** / **adm-zip**（devDeps） — seed パイプライン。
- **Git LFS** — base JPG / mask / shading / 仕上げ PNG / バリアント切り出し（〜50 オブジェクト・〜50 MB）。

### 1.3 アセット配置
```
resources/                                    デザイナー source-of-truth（commit／配信しない）
  base/main/ベースパース_<variant>.jpg          natural / sharp / flat の 3 系統
  reference/部材対応番号-{1,2,3}.pdf            番号付き参照 PDF
  reference/AUTHORING.md                       authoring ガイド
  catalog/部材リスト.xlsx                       オプション一覧（LFS）
  catalog/finish-base-overrides.json           per-(part, option) で variant を割り当てる override

public/                                       Next.js が配信
  assets/base/scenes.json                      scene レジストリの index
  assets/base/main/scene.json                  scene id, dimensions, partsManifestUrl
  assets/base/main/base.jpg                    本番表示の base（既定 = natural）
  assets/base/main/parts.json                  ① 〜 ⑰ の part マニフェスト
  assets/base/main/mask_<NN>.png               part ごとの alpha マスク
  assets/base/main/shading_<NN>.png            color-mode の輝度マップ
  assets/base/main/parts.json.regen.json       /dev/trace の per-part 再生成 hash sidecar（gitignore）
  assets/finishes/<part-id>/<option-id>.png    オプションごとの swatch / texture
  catalog/finish-options.json                  workbook から生成
  catalog/finish-options.warnings.json         抽出時の警告（色抽出失敗・variant 欠落等）
```

---

## 2. 機能仕様（capability 別）

OpenSpec で管理する capability は 8 つあります。

### 2.1 base-perspective-registry — ベースパースのレジストリ
- `public/assets/base/scenes.json`（index）と `public/assets/base/<sceneId>/scene.json`（per-scene）の 2 段。両方 Zod 検証。
- `default: true` の scene が起動時に自動ロード（17 番号マーカー込みで描画）。**default は厳密に 1 件**で、0 件 / 2 件以上は起動失敗。
- ロード時に `base.jpg` と参照する `parts.json` を必ず probe し、欠落時は scene id とファイル名付きで明示的エラー。中途半端な canvas を残さない。
- **Source/Runtime 分離** — `resources/` は配信されない（commit 用）、`public/` だけが Next.js から served。`resources/` から `public/` への変換は documented な seed step（再現可能）で行う。
- **variant base perspectives** — 1 scene に `base_natural.jpg` / `base_sharp.jpg` / `base_flat.jpg` を持てる。runtime は default variant（通常 natural）のみロード。他 variant は seed pipeline の入力で、欠落しても scene ロードは壊れず `variant-missing` 警告で吸収。

### 2.2 numbered-part-overlay — 番号付き部材オーバーレイ
- 各 scene に `parts.json` を必須付帯。`{ id (zero-padded), label(JP), category, sourcePdf(1/2/3), marker(centroid), polygon([[x,y]]), renderMode("color"|"texture"), mask, shading? }` の record 配列。Zod 検証。
- color-mode は `shading` 必須、texture-mode は `shading` 禁止（schema レベル）。
- ⑫ 玄関床は `renderMode: "texture"`（base-variant 切り出し前提）。
- マーカー描画 + 円形 hit-test、ポリゴン点内判定（bbox 近似ではない）で非矩形領域も正確にクリック可能。
- ホバー時は PDF カテゴリ色（オレンジ／青／緑／黄）でダッシュアウトラインを描画。
- 「番号オーバーレイ」トグルで全マーカー＋アウトラインを show/hide。非表示でも左ペインのリストから選択可能。

### 2.3 finish-spec-catalog — 仕上げオプションカタログ
- `public/catalog/finish-options.json` を Zod 検証。`scripts/extract-finish-options.mjs`（`npm run seed:parts`）が `部材リスト.xlsx` から生成。
- 各 entry は `{ id, partId, sheet, label, productCode?, thumbnailUrl, colorHex|textureUrl }` の片方限定。両方ある／無いものは検証で reject。
- **(partId, sheet) ルックアップ** — workbook シート（"アーバンシー" / "レコリード" 等）ごとに該当 part のオプション一覧を返す。
- **シート切替時の選択保持** — `(partId, label)` が一致するものは保持、不一致はクリア＋トースト通知。
- **明示的な「変更なし」オプション** — ② 光無し、⑤ レンジフード unchanged 等は seed が透明等価の entry を出力（非選択ではなく明示的選択）。
- **per-option base-variant override** — `resources/catalog/finish-base-overrides.json` で `(partId, optionLabel) → variantKey` を割り当て、`scripts/cut-base-variants.mjs`（`npm run seed:variants`）が variant base を part mask で切り出し PNG を `public/assets/finishes/<partId>/<optionId>.png` に出力。idempotent。variant 欠落時は `variant-missing` 警告 + 既存 textureUrl 保持で graceful degradation。
- **`_rev` キャッシュバスト** — `loadFinishOptions` が catalog 全体の content hash（FNV-1a 32bit）を返し、runtime は `?v=<_rev>` を全 textureUrl に付与。再 seed で textureUrl の中身が変わっても URL が変わるため確実に reflesh。

### 2.4 color-composition — 色合成パイプライン
- 部材ごとに **専用 Konva Layer**（"one part = one Layer"）。
- **color mode** の描画順:
  1. shading 画像（compositeOperation なし）
  2. 色 Rect（`multiply`）
  3. mask 画像（`destination-in`）— **必ず最後**
- **texture mode** の描画順:
  1. textureUrl 画像（compositeOperation なし）
  2. mask 画像（`destination-in`）— **必ず最後**
- **mask を最後に当てる** のは Canvas2D の `multiply` がアルファ 0 の destination に対して source RGB をそのまま塗ってしまうため。逆順だとマスク外に灰色のにじみが出る。
- `filter: hue-rotate` は使わない（輝度・彩度を保てない）。
- 部材選択をクリアすれば該当部材レイヤーは消え、base.jpg の元ピクセルが復活。
- マニフェスト宣言順で重なり合うマスクの後勝ち。

### 2.5 presentation-canvas — メインキャンバス UI
- 起動時に default scene を自動ロード（ユーザー操作不要）。MVP 時代の scene picker は撤去。
- Zustand store: `activeSceneId`、`activeOptionSheet`、`partFinishSelections: Record<PartId, FinishOptionId>`、`selectedPartId`、`markerVisible`。`placedMaterials` / `axisFilters` / `partColors` は意図的に廃止。
- すべての Konva レンダリングは `next/dynamic({ ssr: false })` 配下の単一 client component に閉じる。
- 部材選択時、隣に該当 (partId, sheet) のオプション chip パネル（swatch + label + productCode）。クリックで `partFinishSelections[partId]` を更新、レイヤーが即時再描画。
- 左ペインに category 別グルーピング（キッチン／照明／玄関／室内建具／床材／収納アクセント／サッシ）の部材リスト。各行に現在選択中のオプション label or "未選択"。マーカー or ポリゴン or リスト行のいずれからでも選択可能。
- シート切替コントロール — 切替時のクリア通知も surface。

### 2.6 project-export — PNG 書き出し
- 「Export PNG」アクションで現在の canvas 状態を PNG 化。base + 全 finish layers + 全 placed material（位置含む）を反映、画面と同一。
- **`pixelRatio: 2`** でステージサイズの 2 倍解像度。エディター chrome（選択ハンドル等）は除外。
- ファイル名: `specdrawing-<sceneId>-<YYYYMMDDHHmmss>.png`（local time）。
- scene 未ロード時は disabled。

### 2.7 material-catalog — 後方互換ファサード
- `(activeScene, activeSheet, partId)` から finish-spec-catalog に薄く委譲する lookup のみ。
- 独立カタログ UI（軸フィルタサイドバー等）は持たない。MVP の `CatalogPanel` は撤去済。

### 2.8 dev-trace-tool — `/dev/trace` デザイナーツール
本番では塞がれる、開発限定のポリゴン編集 UI。
- **Gating** — `process.env.NODE_ENV !== "development"` で `/api/dev/parts` は 404、page 自体は静的プレースホルダ可。
- **dev API** — `GET /api/dev/parts` で manifest + mtime 返却。`PUT` でフルマニフェストを保存、Zod 検証失敗は 422、書き込みは `parts.json.tmp` → 既存を `.bak` にリネーム → `.tmp` を `parts.json` にリネームの**アトミック書き込み**（`.bak` は gitignore）。
- **Autosave** — 600 ms デバウンスで自動 PUT。連続編集はまとめて 1 回。成功で「保存済み HH:MM:SS」を表示。
- **localStorage ドラフト** — 編集毎に `dev:trace:parts:<sceneId>` にミラー。API 不通でも復旧可能。マウント時に disk mtime と draft savedAt を比較し、draft が新しければ復元プロンプト表示。
- **Edge midpoint 挿入** — 既存エッジから 12 px 以内のクリックは中点挿入（垂線足）、それ以外は末尾追加。
- **Undo / Redo** — 履歴 30 段以上、頂点 add / delete / drag-end / marker drag-end / clear / extractor import / part 切替（チェックポイント）で 1 段、ドラッグ中の mousemove 100 連発は 1 段に集約。Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z + ボタン UI。
- **Extractor import** — `/tmp/parts-extracted.json`（PDF からスクリプトで抽出した素材）を per-part 比較パネルで「polygon だけ／marker だけ／両方」のチェックを付けてインポート、各 part 単位で 1 undo。
- **Other-part visibility** — `all` / `current` / `hidden` の 3 状態（localStorage 永続）。
- **マスク auto-regen** — autosave 後 1.5 s デバウンスで `/api/dev/parts/regen` を POST。**per-part hash sidecar（`parts.json.regen.json`）** を比較し、`{polygon + mask + shading?}` の FNV-1a hash が変わった part のみ再生成。エラーでも他部材は影響なし。
- **Force-regen** — `?force=true` で全 part を強制再生成（hand-edit や git restore からの復旧に）。
- **runtime キャッシュバスト** — メイン `/` 側でも `mask_<id>.png?v=<rev>` / `shading_<id>.png?v=<rev>` を付与。`<rev>` は dev-trace 側と同一 hash。再生成後にリロードすると確実に新マスクが反映され、ブラウザキャッシュ／`useImageCache` Map の取り違いを根絶。
- **`Line` クリック透過** — 編集中ポリゴンの `<Line>` は `listening={false}` で fill が click を吸わないようにし、頂点 `<Circle>` だけ右クリック削除・ドラッグ移動を受ける。
- **ヘッダー高さ固定** — save badge / regen badge は固定幅・`whitespace-nowrap`、長文は tooltip に逃がす（status 遷移で canvas の Y 座標が動かない）。
- **手動ダウンロード** — `parts.json` ダウンロードボタンも残し、API 不通時の脱出口。

---

## 3. シードパイプライン

3 ステップ独立。順不同で再実行可能。

| コマンド | 役割 |
|---|---|
| `npm run seed:parts` | `部材リスト.xlsx` → `finish-options.json`（色抽出 + downsample + 警告書き出し）|
| `npm run seed:masks` | `parts.json` のポリゴン → `mask_<NN>.png` + `shading_<NN>.png` |
| `npm run seed:variants` | `finish-base-overrides.json` を読み、各 variant base から part mask で切り出した PNG を `public/assets/finishes/<partId>/<optionId>.png` に書き、`finish-options.json` の textureUrl を書き換え。さらに `finish-variant-mapping.json` の `overrides`（variant 再割当 + クロスシート合成）／`tintBase`（代替オプションを base 質感で着色）／`noEffect`（②「無」の周辺色フィル）／`colorHexByVariant`（color-mode の per-variant `#RRGGBB`）を適用する |

---

## 4. レンダリング不変条件（壊すと回帰する）

1. **mask は最後に当てる**（color / texture 両モード）。逆順 = マスク外に灰色／texture のにじみ。
2. **part = 1 Layer**。同 Layer に 2 part を載せると、後 part の最初の draw が前 part のマスク済み内容を上塗りする。
3. **マーカー / ポリゴン outline は finish layer の上**。
4. **runtime URL は cache-bust 必須** — mask / shading / textureUrl 全部 `?v=<rev>` 付き。
5. **dev API は production で常に 404**。

---

## 5. 受け入れ基準（スモーク）

`npm run dev` 後、`http://localhost:3000` で：

1. 17 番号マーカーが見え、デフォルトパースが自動ロード。
2. ⑦「キッチンアクセントクロス」を押し、"アーバンシー" の chip 一覧が出る。
3. 「サンドベージュ」を選ぶ → 該当領域だけサンドベージュにティント。
4. ⑩ → 「ｺｺﾅｯﾂﾁｪﾘｰ」 → ドアパネル領域が木目テクスチャに差替わる。
5. シートを「レコリード」に切替 → ⑦ サンドベージュは保持、不一致選択はクリア＋トースト。
6. 「番号オーバーレイ」OFF → マーカー消える、finish 描画は維持。
7. 「Export PNG」 → `specdrawing-main-<timestamp>.png` がネイティブ解像度（3000×2142）で download。マーカーは export に含まれない。

---

## 6. 進行中の変更提案

### 6.1 `improve-finish-fidelity` — variant ↔ ラベルの不整合修正 + tint-base 仕上げ + 特殊ケース対応

**Purpose / Context**: `add-urban-sea-variants-and-parts-export` 出荷後のデモ歩きで判明した 3 系統の忠実度ギャップ（① workbook の Natural/Flat/Sharp 列割当ミス、② 代替オプションが平面色で描画されて木目が消える、③ ② キッチン間接照明「無」が消えていない / ⑰ サッシ枠の color パレットがバリアント背景と合わない）を、ランタイムを変えずに seed 層 + config 層で解消する。

**Goals / Non-Goals**
- (G) ⑩ ⑪ ⑬ ⑭ の variant ↔ ラベル割当を designer-owned config で上書き（workbook 修正サイクルを待たない）。⑩ ⑬ ⑮ の代替オプションを **tint-base**（既定オプションの輝度パターン × アイコン色）で着色描画。② 「無」を周辺色フィルで erase。⑰ に `colorHexByVariant` を導入して per-variant パレット。
- (NG) ランタイムレンダラの構造変更（`textureUrlByVariant` の既存契約に乗る）。テストフレームワーク導入は別 change。`レコリード` シートは別 change（合成は今 change 内、本格対応は別）。

**Decisions**
- **D1**: workbook ではなく **designer-owned `finish-variant-mapping.json`** で variant 割当を上書き（顧客往復なし）。`overrides` ブロック適用は seed 内で workbook 解析後・`textureUrlByVariant` 生成前。
- **D2**: ⑭ ブラックなど primary シートに無いラベルは **クロスシート合成**：`レコリード` から同 `(partId, label)` をコピーし `synthesized: true` を付与。次回 workbook に追加されれば workbook 側を優先。
- **D3**: tint = 線形 sRGB 輝度（Rec.709 重み）× 非白アイコン平均色の **multiply blend**。`tintBase` は `finish-base-overrides.json` 内に追加（既存の `overrides` と同居）。alt PNG は `<partId>/<optionId>__<v>.png` × 3、cache-bust 契約のため variant ごとに別ファイル。
- **D4**: ② 「無」は part mask を 16px 外側に dilate した「近傍リング」の平均 RGB を solid-fill。**linear inpainting / blur 系は導入しない**（依存追加に対して効果薄）。
- **D5**: `colorHexByVariant` は色オプションの `colorHex` に対する optional override（partial 可、未指定キーは静的 `colorHex` にフォールバック）。ランタイムは `option.colorHexByVariant?.[activeVariantKey] ?? option.colorHex`。
- **D6**: ⑰ パレット初期値は `scripts/suggest-sash-palette.mjs` が variant base 周辺の壁色平均 × blend-weight 0.3 で出力（curate 前提）。

**Risks / Trade-offs**
- Override drift（顧客が後で workbook を直しても override が黙って上書きを続ける）→ seed 開始時に override 件数 + 対象 partId を一覧ログ出力（人がレビュー）。
- 合成 ⑭ ブラック が `レコリード` 側の修正に追従する → 合成元シートをログに記録、固定したくなったら override に明示コピーする運用。
- tint の dominant color 抽出はスウォッチが薄い場合に低信頼 → `tint-color-low-confidence` 警告（>5% 非白ピクセル要件）。
- 資産増（⑩ 28 alts × 3 variants = 84 PNG / 部材）→ bbox crop で 〜30 KB/PNG、LFS 容量内。

**Migration Plan**
1. schema 拡張（`colorHexByVariant`, `synthesized` 追加 / `variantMappingSchema` / `tintBaseSchema`）— 全て optional、後方互換。
2. `finish-variant-mapping.json` 作成（⑩ ⑪ ⑬ ⑭ の overrides + ② noEffect + ⑰ colorHexByVariant）。
3. `finish-base-overrides.json` に `tintBase` ブロック追加。
4. `npm run seed:parts && npm run seed:variants` 再実行。
5. ランタイム `PartFinishLayer.tsx` を `colorHexByVariant` 解決に対応（1 行）。
6. `/` で variant 切替スモーク（Section 9）。

**進行状況**: コードはマージ待ち。schema・seed pipeline・runtime はすべてランディング、`scripts/suggest-sash-palette.mjs` と `scripts/audit-finish-options.mjs` も整備済。⑰ パレットは初期値投入済（要 designer タッチ）。インタラクティブスモークが残タスク。

### 6.2 `add-urban-sea-variants-and-parts-export` — アーバンシー variant スイッチャー + 選択部材 Excel 出力

**Purpose / Context**: 現状ベースパースは固定（natural）。デザイナーは `_natural / _flat / _sharp` 3 系統を seed 用に納品済みだが、ランタイムは natural しか描かない。顧客は同じ部屋を異なるムードで比較できない。さらに PNG だけだと「何を選んだか」を持ち帰れない。`部材リスト.xlsx` から取れる部材名・型番・アイコンを Excel に同梱して 1 click で持ち帰れるようにする。

**Goals / Non-Goals**
- (G) アーバンシーシートで Natural/Flat/Sharp を runtime 切替（背景 + texture-mode 部材の crop が同時更新）。アクセントクロス（#07・#16）以外は texture-mode を既定に。`部材リスト.xlsx` 由来のアイコン + 型番を Excel に inline 埋込。1 click で PNG + Excel 両出力。
- (NG) アーバンシー以外の variant 切替。混合 variant（部材ごとに別 variant）。Excel 多 variant 同梱。color overlay の挙動変更。

**Decisions**
- **D1**: Variant 切り替えで使う画像は **seed 時に pre-cut**。runtime は単に URL を差し替えるだけ。`scripts/cut-base-variants.mjs` を拡張し `_v_<variant>.png` を全 variant ぶん書く。
- **D2**: `variantsEnabled` フラグは **シート側に置く**（`public/catalog/sheets.json`）。シーン側の `variants[]` は資産だけ、UI を出すかはシートが決める。
- **D3**: アクセントクロス除外は **part id ホワイトリスト**（`"07"` `"16"`）で表現。新フィールドは入れない。
- **D4**: Excel 出力は `exceljs`、**動的 import**。`worksheet.addImage` で各行アイコンを inline 埋込。
- **D5**: ファイル名は `specdrawing-<sceneId>-<variantKey>-<YYYYMMDDHHmmss>.{png,xlsx}`。1 click で PNG/Excel 同 timestamp 共有。
- **D6**: ハードカット移行（**Goal**：schema 必須化）。**実装中の現実的譲歩**：(a) `iconUrl` は schema 上 optional・seed が thumbnail を 96×96 にコピーして自動生成、(b) cross-validators は warn-mode（`crossValidatePartsAgainstSheets` / `crossValidateOptionsAgainstSheets`）で起動を阻害しない。顧客が `部材リスト.xlsx` をリフレッシュした後 strict に戻す。

**Risks / Trade-offs**
- 部材 #15 床（LDK）と #17 サッシ枠は現状 color-mode で多数のオプションを持つため、texture-mode へ強制 flip すると既存 finish-options.json が schema-invalid になる → **顧客側 workbook リフレッシュ後に flip**（タスク 2.2 / 2.8 を deferred）。
- variant 切替時に 3 枚 texture が再ロードされちらつく → 選択中 part の他 2 variant を `prefetchImages` で warm。
- `exceljs` クライアントバンドル ~200 KB → 動的 import で初回 click まで遅延。

**Migration Plan**
1. Schema 追加：`scenesSchema` に `variants[]`、`finishOptionSchema` に `iconUrl` / `textureUrlByVariant`、`sheetsManifestSchema` 新設。すべて optional（移行中も既存ファイルが通る）。
2. `scene.json` に variants 3 entry 追加、`public/catalog/sheets.json` を author（アーバンシー = variantsEnabled: true / natural）。
3. `seed:parts` を再実行 → `iconUrl` が全 option に付く、`sheets.json` が再生成される。
4. `seed:variants` を再実行 → 全 アーバンシー texture option に `textureUrlByVariant` が埋まる。
5. ランタイムを起動：variant スイッチャーがアーバンシーで表示。Natural/Flat/Sharp 切替で texture-mode 部材が crop 切替。
6. 「選択部材エクスポート」で PNG + Excel 同 timestamp 出力。Excel は全 part ぶんの行（選択 / 既定 / 対象外）。
7. **顧客 workbook 更新後**：parts.json で #15 #17 を texture-mode に flip、cross-validators を strict に戻す（[lib/finishes/load.ts](../lib/finishes/load.ts) の `mode` 引数 `"warn"` → `"strict"`）。

### 6.3 `rewrite-seed-for-variant-keyed-workbook` — 新ワークブック構造の seed パーサー書き換え

**Purpose / Context**: 顧客が `部材リスト_20260430.xlsx`（→ canonical 名 `部材リスト.xlsx` にリネーム）で列構造を一新。D/E/F に Natural / Flat / Sharp 列を予約、G+ に customer-selectable な alternatives を置く形式。旧 seed は「列 D 以降全部が options」の素直なシーケンシャル parser だったので、新構造では label collision（同じラベルが N/F/S に重複）と image anchor 不一致（swatch が異なる列に anchored）で 198 個の missing-swatch warning が出て使い物にならなかった。

**Goals / Non-Goals**
- (G) アーバンシーの新 layout を正しく parse、レコリードが旧 layout のままでも fall-back で動く。`defaultForVariants` を schema に追加して「どの variant でこの option が default か」を明示。canonical 名 `部材リスト.xlsx` で seed が走る。
- (NG) ランタイムが `defaultForVariants` を実際に auto-apply（variant に応じて未選択 part のオプションを切替）する機能、`cut-base-variants.mjs` リライト、test runner 配線。

**Decisions**
- **D1**: Header-row driven column resolution。row 0 で `Natural`/`Flat`/`Sharp` を case-insensitive lookup、見つかれば variant-keyed layout、見つからなければ legacy fallback（per-sheet 自動切替）。
- **D2**: 同一 label collapse。`Natural=白, Flat=白, Sharp=黒` → 2 options（白 with `defaultForVariants: ["natural", "flat"]`、黒 with `["sharp"]`）。
- **D3**: 旧 layout は seed エラーにせず legacy parser に fall-back（design.md Open Question で示唆された運用方針）。`old/部材リスト.xlsx` を archive として保持、`SPECDRAWING_WORKBOOK` 環境変数で旧版に明示的に切替可能。
- **D4**: `<a:blip>` 解析の正規表現バグ修正。旧 regex `[^/>]+` は xmlns URL の `http://` で `/` に当たって match break。新 regex `[^>]*?` で吸収。これで modern .xlsx の image anchor lookup が機能する。

**Risks / Trade-offs**
- swatch 画像が variant-default に存在しないケースが多い（顧客は「variant base 自体が表示」前提で省略している）→ gray placeholder が side-panel chip に出る可能性。許容範囲、後続で variant base の crop を thumbnail にする手も。
- 同一 label collapse で複数列が異なる product code を持つ場合、左端優先 + warning。実データで衝突は今のところ無し。

**Migration Plan**
1. Schema 追加：`finishOptionSchema` に `defaultForVariants` / `subLabel`、cross-validator `crossValidateDefaultsAgainstScene`。
2. workbook を canonical 名にリネーム。
3. parser 書き換え（auto-detect layout、collapse、sub-row scan、blip regex 修正）。
4. `seed:parts` → `seed:variants` 順に再実行。
5. ランタイムでは新 schema の `defaultForVariants` は **読まない**（次の change で消費）。

### 6.4 `add-vercel-deployment` — Vercel への production + preview デプロイ

**Purpose / Context**: 現状ローカル `npm run dev` のみ。顧客プレビュー / デザイナー共有 / PR ごとの canonical URL を提供するためにホスティング必須。GitHub Pages は不可（Route Handler 不可・`next/image` 最適化不可・LFS 解決不可）。Vercel は 3 点ともネイティブ、PR ごとの自動 preview が無料。`/dev/trace` を preview だけで有効化し、production はクリーン保持が運用の要。

**Goals / Non-Goals**
- (G) `main` push で自動更新の本番 URL 1 本。ブランチ／PR ごとの preview URL。preview 上で `/dev/trace` 稼働。LFS 資産が実バイト配信。ローカル開発は不変。
- (NG) カスタムドメイン適用（DNS は顧客作業）。別 CI 追加なし。`/api/dev/*` 以外のサーバ機能なし。preview への HTTP 認証なし。プリレンダー方針変更なし。

**Decisions**
- **D1**: Vercel 採用。Cloudflare Pages / Netlify は同等だが App Router 追従度が最高で Next.js 公式ホスト。
- **D2**: **LFS をビルド時 pull**。`vercel.json` で install command を `git lfs install --force && git lfs pull && npm install` に上書き（Vercel の `filter.lfs.smudge = --skip` を `--force` で打ち消す）。pull 失敗のスモークは `file -b ... | grep -q JPEG`。
- **D3**: `/dev/trace` ゲートを `NODE_ENV === "development" || VERCEL_ENV === "preview"` に拡張。production（`VERCEL_ENV === "production"`）は **404 維持**。preview は noindex 自動付与、書込はその preview FS に閉じる。
- **D4**: `mask_*.png` / `shading_*.png` / `_v_*.png` / 仕上げ PNG は `Cache-Control: public, max-age=31536000, immutable`（`?v=<rev>` で content-hash バストしているので安全）。manifest 系（`parts.json`、`finish-options.json`、`scenes.json`、`scene.json`）は `no-cache`。
- **D5**: `next/image` 最適化は Vercel が透過適用（`FinishOptionPanel` / `ExtractorImportPanel` のみ）。Konva 経由のテクスチャは原本ピクセル必須なので最適化を経由させない。
- **D6**: **Hobby（$0）開始**。商用カスタムドメイン適用時のみ Pro（$20/user/月）に上げる。
- **D7**: 当面 `*.vercel.app`、カスタムドメインは DNS 来てから 30 分で適用可。

**Risks / Trade-offs**
- GitHub LFS quota 1 GB/月 vs cold ビルド 50 MB/回 → 月 20 cold で枯渇。warm キャッシュ再利用で実用は吸収、超えたら data pack。
- preview URL 検索流出 → Vercel が `X-Robots-Tag: noindex` 自動付与、共有は production URL 優先。
- preview 編集の非永続化はデザイナー混乱誘発 → AUTHORING.md に「download → commit → push」を明記。
- preview と production の表示差 → 顧客デモは production、デザイナー反復は preview と運用分離。
- noisy ブランチでビルド分嵩む → "Cancel previous builds" を有効化。

**Migration Plan**
1. Vercel ダッシュボードで `tatoflam/SpecDrawing` import（production = `main`、preview = 全ブランチ + PR）。
2. プロジェクト設定の Install Command を上書き。
3. リポジトリに `vercel.json` 追加（install + LFS smoke + cache headers）。
4. `app/api/dev/parts/route.ts` と `app/api/dev/parts/regen/route.ts` の `devOnly()` を `NODE_ENV || VERCEL_ENV === "preview"` に拡張。
5. `/dev/trace` の本番 fallback メッセージを「本番環境では `/dev/trace` は無効です」に明文化。
6. feature branch を push して preview 検証 → main マージで production 検証。
7. README / AUTHORING.md に URL と運用フロー追記。
- **Rollback**: `vercel.json` + ゲート差分を revert。Vercel プロジェクト削除はリポに影響なし。

---

## 7. 工数見積（2026-04-27 棚卸し / senior フルスタック 1 名・人時間）

### 7.1 完了済み（実装＋テスト＋ドキュメント込）

| # | フェーズ / change | 主な内訳 | 時間 |
|---|---|---|---:|
| 0 | `add-material-presenter-mvp` | Next.js 14 scaffold / Konva canvas + SSR boundary / multi-axis catalog / mask×shading×color 合成 / PNG export / 手続的 seed assets / OpenSpec 初期化 | **30 h** |
| 1 | `redesign-numbered-part-finish-picker` | proposal+design+specs (6h) / asset staging+LFS (2h) / loaders+Zod (8h) / xlsx→JSON+画像 zip (8h) / 色抽出+downsample (4h) / numbered-part overlay+hit-test (6h) / PartFinishLayer 2-mode (6h) / Panel/Switcher/Toggle (6h) / sheet 切替+selection 保持 (3h) / page 再構成 (3h) / smoke+docs (2h) | **54 h** |
| 2 | `designer-followups` | 実 shading 抽出 (3h) / mask AA (1h) / swatch downsample (1h) / PDF polygon 抽出多回試行 (8h) / 手 polygon 大雑把版 (4h) / `/dev/trace` 初版 (8h) | **25 h** |
| 3 | `enhance-dev-trace` | spec+design (4h) / dev API+atomic write+Zod (4h) / draft+restore (3h) / undo/redo (3h) / midpoint insert (2h) / extractor import panel (3h) / 3-state visibility (1h) / mask auto-regen+.bak diff (2h) / cache-bust per-part `_rev` (2h) / 不具合 #1〜#3 (6h) / smoke+docs (2h) | **32 h** |
| 4 | ⑨ ポリゴン手調整 | `/dev/trace` で 30 頂点トレース + commit | **1 h** |
| 5 | `add-base-variant-finishes` | spec+design (4h) / asset rename+scene.json (1h) / override config (1h) / cut script (3h) / bbox crop+dedupe+textureBox (3h) / FinishOption schema 拡張 (1h) / PartFinishLayer (1h) / catalog cache-bust (2h) / parts.json ⑫ flip (0.5h) / LFS pattern (0.5h) / smoke+docs (2h) | **19 h** |
| 6 | archive 系（5 件） | live spec 取り込み + branch + PR + sync の繰返し | **5 h** |

**完了済み小計：~166 h（≒ 4 人週）**

### 7.2 今後 — A. 機能改善（`improve-finish-fidelity` 内訳）

| 項目 | 内容 | 時間 |
|---|---|---:|
| Item 1+2 統合 (`add-multiring-polygons`) | schema 多リング化 / rasterizer 書換（穴=even-odd）/ hit-test / parts.json 移行 / `/dev/trace` UI / spec+test+docs | **30 h** |
| Item 3 (`add-per-option-finish-renders`) | `customTextureUrl` / `seed:custom-textures` / seed:parts 保護 / docs | **6 h** |
| Item 4 spike (`spike-ai-asset-generation`) | SD/ControlNet inpainting 検証 / 5 サンプル / go/no-go memo | **16 h** |
| Item 4 implementation（条件付） | spike が viable なら Item 3 パイプラインに統合 | **+16〜24 h** |
| Item 5 背景色補正 | 顧客側 re-render 依頼を第一選択。代替で sharp `.modulate()` 1 行 | **4 h** |

**A 小計：~56 h（最小）/ ~80 h（AI 実装込み）**

### 7.3 今後 — B. デプロイ（`add-vercel-deployment` 内訳）

| 項目 | 時間 |
|---|---:|
| Vercel プロジェクト作成 + Install Command override | **2 h** |
| `vercel.json`（LFS pull + JPEG smoke + cache headers） | **2 h** |
| `devOnly()` ヘルパー拡張（NODE_ENV + VERCEL_ENV） | **1 h** |
| `/dev/trace` の本番 placeholder | **1 h** |
| 検証（preview + production smoke） | **2 h** |
| README + AUTHORING.md 更新 | **2 h** |
| カスタムドメイン適用（任意・DNS 待ち） | +**2 h** |

**B 小計：~10 h（カスタムドメイン込み ~12 h）**

### 7.4 今後 — C. 本番投入のために残る "それ以外"

| 項目 | 時間 |
|---|---:|
| 17 部材のポリゴン本トレース（designer 作業） | designer **16 h** / dev 0 |
| テクスチャ系 finish の本制作（⑩ 30 色・⑬ 12 色 等の scene-resolution renders） | designer **30〜80 h** |
| エラー監視 / 簡易 telemetry（Sentry + Vercel Analytics） | dev **6 h** |
| モバイル / レスポンシブ調整（現状 1100 px 横幅前提） | dev **8 h** |
| パフォーマンス監査（Lighthouse / bundle / Konva レイヤ最適化） | dev **4 h** |
| 顧客向け運用ドキュメント | dev **6 h** |
| レビュー / 不具合修正バッファ（上記 ~20%） | dev **15 h** |

**C 小計：dev 39〜45 h ＋ designer 46〜96 h**

### 7.5 今後 — D. 仕様 non-goals（保留中・要望次第）

| 項目 | 時間 |
|---|---:|
| プロジェクト保存 / 復元 | 16 h |
| 複数シーン / マルチパース展開 | 16 h |
| 高解像度 PDF 出力（server-side） | 24 h |
| 認証 / マルチユーザー | 24 h |

**D 小計：~80 h**

### 7.6 合計 + 期間換算

| 区分 | dev 時間 | designer 時間 | 累計 (dev) |
|---|---:|---:|---:|
| 完了済 | 166 h | 1 h | 166 h |
| A 推奨パスのみ | 40 h | — | 206 h |
| A AI 実装まで含む | +16〜24 h | — | 222〜230 h |
| B Vercel デプロイ | 10〜12 h | — | 216〜242 h |
| C 本番投入残作業 | 39〜45 h | 46〜96 h | **255〜287 h** |
| D 保留中 | +80 h | — | (335〜367 h) |

- **デモ可能ライン**（A 推奨 + B + C 必須）：**255〜287 h ≒ 6.5〜7.5 人週**
- **保留機能まで含む完成ライン**：**335〜367 h ≒ 8.5〜9 人週**

### 7.7 前提・注意

1. **デザイナー作業は別工数**。⑪ 等のポリゴン本トレースや高品質テクスチャ生成は人手必須で、開発工数とは独立。
2. **AI 生成パイプライン** は spike 結果次第で実装工数が 16〜40 h と振れる（見積では 16 h 確保、実装は条件付）。
3. **インフラランニングコスト** — LFS quota / Vercel Pro 化 / DNS 移管。Hobby なら $0、Pro なら $20/月、ドメイン代別。
4. **テスト工数** は dev 時間に内包。unit/integration はまだ薄いので堅牢性を上げるなら +20% 想定。
5. **このセッション中の Claude のスループット** はチーム比 30〜40 倍程度だが、対人作業（顧客すり合わせ・ステークホルダー調整）が増えるフェーズでは倍率が落ちる。

### 7.8 推奨優先順位（デモまでの最短経路）

**Item 5（背景色）→ B（Vercel）→ Item 1+2（multi-region + holes）→ 17 部材本トレース**

見え方の歩留まりが最も大きく上がる順。

---

## 8. 運用コスト試算（社内利用想定 / PNG Export 100 件/日）

### 8.1 利用シナリオ前提

- **ユーザー**: 設計者・PM・営業（社内）合計 10〜30 名想定。
- **PNG Export**: 1 日 100 件（顧客提案資料への書き出し用途）。
- **同時に発生するセッション**: 1 セッションに複数 export することが多い前提で、1 日 50〜100 セッション、月 1,500〜3,000 セッション。
- **Vercel デプロイ頻度**: アクティブ開発期は 30〜50/月、運用安定後は 5〜10/月。

### 8.2 トラフィック試算

PNG export 自体はクライアントの Konva 上で生成（`stage.toDataURL`）し、ブラウザから直接ダウンロードされるため**サーバ帯域は消費しない**。サーバ側に発生するのは「画面を開いた／部材を切替えた／シートを切替えた」ときのアセット配信のみ。

| 種類 | 配信量/セッション | キャッシュ可能性 |
|---|---:|---|
| `base.jpg`（3000×2142 JPG） | 〜3 MB | manifest 連動で `no-cache`（再デプロイで即時反映）|
| `mask_<NN>.png` × 17 | 合計〜3 MB | `immutable, max-age=31536000`（`?v=<rev>` バスト）|
| `shading_<NN>.png` × 10 | 合計〜3 MB | 同上 |
| 仕上げ PNG / variant cuts | 合計〜5 MB | 同上 |
| HTML / JSON / JS bundle | 〜2 MB | 標準キャッシュ |
| **cold session 合計** | **〜16 MB** | — |
| **warm session 合計**（mask 等キャッシュ命中） | **〜5 MB** | — |

cold/warm ミックスを 30 / 70 で見積：平均 **〜8 MB/session**。

| 月間 | 試算 |
|---|---:|
| セッション数 | 1,500〜3,000 |
| 帯域 | **12〜24 GB/月** |
| Vercel Hobby 上限（100 GB/月） | 余裕 75〜90 % |
| Vercel Pro 上限（1 TB/月） | 1〜3 % |

→ 帯域は **Hobby tier の上限内に十分収まる**。Pro 化は帯域要因では不要。

### 8.3 ビルド時 LFS 帯域

- cold ビルド 1 回 = LFS 〜50 MB pull。
- 月 30〜50 デプロイの 30 % が cold 想定 → 9〜15 cold × 50 MB = **0.45〜0.75 GB/月**。
- GitHub LFS 無料枠 1 GB/月 → **無料枠内**。
- 超過時は GitHub Data Pack $5/50 GB/月 で吸収可能。
- 安定運用期（10/月、cold 30 %）はさらに余裕（〜0.15 GB/月）。

### 8.4 サーバ実行時間（Vercel Functions）

- production の `/api/dev/*` は 404 のため**実行 0**。
- preview の `/dev/trace` 編集ぐらいで月数百回・各 < 100 ms → Hobby の 100 GB-Hours / 月にはまったく届かない。
- 本番 PNG export はクライアント生成のためサーバ functions 不要。

### 8.5 月額コスト試算

#### A. 推奨構成（Vercel Pro + 既存独自ドメインなし）

| 項目 | 月額（USD） | 月額（JPY 換算 ¥150/USD） | 備考 |
|---|---:|---:|---|
| Vercel Pro（1 seat） | **$20** | **¥3,000** | 商用 SaaS 利用に必要な最低構成。バンド幅 1 TB / Build 24,000 min / Concurrent build 12 |
| GitHub LFS data pack（必要時） | $0〜$5 | ¥0〜¥750 | 多くの月は free 枠内 |
| Vercel Analytics（Pro 標準同梱） | $0 | ¥0 | 基本指標 |
| カスタムドメイン年額（任意） | $1〜$2 | ¥150〜¥300 | `.com` 〜 `.co.jp` 月割 |
| **小計** | **$21〜$27** | **¥3,150〜¥4,050** | — |

#### B. 最低構成（Hobby のまま社内検証段階）

| 項目 | 月額 | 備考 |
|---|---:|---|
| Vercel Hobby | $0 | 規約上は **non-commercial / personal** 限定。社内 PoC 段階や数日のデモ用途では暫定的に許容、商用本運用は Pro へ移行 |
| GitHub LFS | $0 | 無料枠内 |
| **小計** | **$0** | 中〜長期運用には不適 |

#### C. 拡張オプション（必要になったときのみ）

| 項目 | 月額 | 備考 |
|---|---:|---|
| Vercel Password Protection on previews | Pro 標準 | preview URL 漏洩時の `/dev/trace` 書込防止 |
| Sentry Team plan | $0 / $26〜 | 月 5K events まで無料、商用エラ-監視を入れる場合 |
| Vercel チームメンバー追加 | +$20/seat | 開発・運用に複数人がダッシュボード利用する場合 |
| ドメイン更新料 | 〜$15/年 | `.com` で年 $10〜$15 |

### 8.6 年額換算とランニングコスト感

- **A. 推奨構成**: $252〜$324/年 ≒ **¥38,000〜¥49,000/年**
- **負荷スケーリング感**: 100 件/日 × 365 日 = 36,500 件/年 の export を支える運用コストが約 4 万円。1 export あたり **〜¥1.1**。
- 1 日 1,000 件まで増えても帯域 240 GB/月 で Pro tier の 25 % 以下、コスト構造は変わらない。
- 1 日 10,000 件規模になって初めて Pro tier 帯域の 200 % に迫り、Enterprise / 別 CDN 連携を検討する必要が出る。

### 8.7 コスト変動要因（注意点）

1. **Vercel チームメンバー数** が一番効く。1 seat 増えるごとに +$20/月。実運用で必要なのはデプロイ承認権限を持つ 1〜2 名で、閲覧者は seat 不要。
2. **LFS 帯域** はデプロイ頻度と cold/warm 比に比例。warm キャッシュ無効化（`package.json` 変更等）が頻発するとデータパック購入が必要になる可能性あり。
3. **Vercel 帯域** は base 画像系の差替が頻発しないかぎり安定。複数シーン展開（D 保留機能）に進むと比例増。
4. **Sentry / 監視ツール** を入れるかどうかで +$0〜$30/月 程度。社内利用かつトラフィック少ない現状では当面なしでも可。
5. **将来の認証導入** を社外ユーザに開く場合は Vercel SSO 等の Pro/Enterprise 機能、もしくは Auth0 ($23/月〜) 等の追加費用が乗る。

### 8.8 ざっくり結論

- **PNG Export 100 件/日 × 社内 10〜30 名** の規模は、**Vercel Pro $20/月 + LFS 無料枠** で十分賄える。
- 月額 **約 ¥3,000〜¥4,000**、年額 **約 ¥38,000〜¥49,000** のランニングコストで運用可能。
- スケール余裕は 10 倍程度（1,000 件/日）まで構成変更不要。
- 主なコスト増要因は「Vercel team seat 数」「Sentry など追加監視」「複数シーン展開」「社外公開化に伴う認証」の 4 つ。
