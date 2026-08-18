## Why

現行 SpecDrawing は「commit 済みの内観ベースパース × 番号付き 17 部材 × `部材リスト.xlsx` 由来の仕上げ」に閉じた内観プレゼンターで、**案件ごとに異なる外観パースを扱う導線がまったく無い**。外装の意匠決定（ジョリパッド色の塗り分け、その他外装の指定）は現状すべて紙のカタログと口頭・手描きで行われており、顧客打合せの場でその場に色を当てて見せることも、決まった仕様を機械可読な形で持ち帰ることもできない。

外観パースは内観と違って **案件ごとの一点物**であり、事前に commit してマスクを seed 生成する既存の運用（`parts.json` + `npm run seed:masks`）が原理的に成立しない。したがって「その場でアップロードして、その場でポリゴンを引いて、その場で色を当てる」ワークフローを新しいモードとして立てる必要がある。

## What Changes

### 1. モード分岐（メインメニュー）

- `/` を **モード選択メニュー**にする。「内観パースイメージ作成」「外観パース塗り分け」の 2 択。
- 既存の内観プレゼンターは `/interior` へ移設し、**挙動は一切変えない**（default scene 自動ロード・17 部材・シート/バリアント切替・選択部材エクスポートすべて現状維持）。
- **BREAKING**（運用面のみ）: `/` を直接ブックマークしていた利用者は 1 クリック増える。内観機能そのものの後方互換は保たれる。

### 2. 外観プロジェクト・ワークスペース（新規 `/exterior`）

- ローカルのホワイトパース画像（JPG / PNG）を **ドラッグ&ドロップまたはファイル選択でアップロード**。
- **1 案件に複数画像（アングル）**。アングル間はタブ/サムネイルで切替。ポリゴンと色の割り当ては**アングルごとに独立**。
- 画像・ポリゴン・色選択・その他外装プロンプトは **IndexedDB に永続化**（サーバ送信なし）。リロード後も作業継続可能。
- 案件は複数持てる（案件名で識別）。案件の削除・切替。
- 画像は原寸バイナリ（Blob）を IndexedDB に保持し、`URL.createObjectURL` で Konva に渡す。**サーバへは一切アップロードしない**ので Vercel の ephemeral FS 問題を回避する。

### 3. ジョリパッドカラーカタログ（新規 seed + カタログ）

- `scripts/extract-jolypate-colors.mjs` を新設（`npm run seed:jolypate`）。`public/assets/jolypate/ジョリパカタログ 3.pdf`（AICA JOLYPATE COLOR TABLE −CHROMATONE−／全 8 ページ／NEUTRAL・MISTY・SUNNY・TRAD の 4 カテゴリ／全 148 色）を解析し、`public/catalog/jolypate-colors.json` を生成する。
- **選択可能なのは色番ラベルの背景が黄色のもののみ**。黄色ハイライトの無い色番（`T6013` / `JP-100BK` / `JP-100SBK` / `JQ-200SBK` / `JQ-650SWH` / `T6401` / `T6405` / `T6404` / `T6010` / `T6702` 等の調色不可・特注色）は **カタログに出力しない**。
- 各エントリは `{ code, category, page, cell, colorHex, swatchUrl }`。`colorHex` はスウォッチ矩形のロバスト平均色、`swatchUrl` は切り出した PNG。
- 抽出漏れ・低信頼は `public/catalog/jolypate-colors.warnings.json` に書き出す（既存 `finish-options.warnings.json` と同じ思想）。
- **砂岩風仕上げ** — `public/assets/jolypate/ジョリパッド砂岩仕上.jpg` を tileable な質感テクスチャとして seed が正規化し、ゾーンごとに ON/OFF できる「仕上げテイスト」として提供する（色 × 砂岩テクスチャの合成）。
- サイドペインの選択 UI は既存 `FinishOptionPanel` と同じ chip 型（スウォッチ + 色番 + 色名）。カテゴリ（NEUTRAL / MISTY / SUNNY / TRAD）でグルーピングし、色番テキスト検索を付ける。

### 4. 塗り分けゾーンのポリゴン作成（production で動く新エディタ）

- 既存 `/dev/trace` と**同じクリック操作規約**でポリゴンを作成する:
  クリックで頂点追加 / 既存エッジ 12px 以内は中点挿入（垂線足）/ 右クリックで頂点削除 / 頂点ドラッグで移動 / `Cmd+Z`・`Cmd+Shift+Z` で undo・redo（30 段以上、ドラッグ中の連続 mousemove は 1 段に集約）/ `<Line>` は `listening={false}` で fill がクリックを吸わない。
- ただし `/dev/trace` は dev/preview 限定ゲート下にあるため、**共有可能な再利用コンポーネントとして抽出**し、外観エディタは production でも動く独立コンポーネントとして実装する（`/dev/trace` 自体の挙動は変えない）。
- ゾーンは `{ id, label, polygons: Polygon[], colorCode | null, opacity, sandstone }`。`polygons` は既存 `lib/parts/types.ts` の multi-ring 形（`outer` + `holes`）をそのまま使い、`lib/parts/hitTest.ts` / `lib/parts/polygonOps.ts` を再利用する。
- ゾーンの追加・リネーム・削除・並べ替え（重なり順）。ゾーン一覧はサイドペインに出し、行クリックで選択（既存 `PartList` と同じ操作感）。

### 5. 塗り分けの合成（マスク PNG を作らない）

- **ホワイトパースに既に光のコントラスト（明度・影）が焼き込まれている**ことを前提とし、白パース自体を shading マップとして使う。したがって **`shading_NN.png` に相当する資産は生成しない**。
- 描画は「ベース画像 → ゾーンごとの色 Rect（`multiply` + ユーザー指定の不透明度）→ ポリゴンで clip」。**サーバ側 sharp によるマスク PNG のラスタライズは行わず**、Konva の `clipFunc` を even-odd（穴あり対応）で使う。
- **不透明度はゾーンごとにスライダで指定**（既定 0.85、範囲 0–1）。白パースの陰影をどれだけ透かすかを打合せの場で調整できる。
- 砂岩仕上げ ON のゾーンは、色 Rect の上に砂岩テクスチャを `overlay` 相当で重ねてから clip する。
- 既存レンダリング不変条件を踏襲: **1 ゾーン = 1 Konva Layer**、**clip は最後に効かせる**、ポリゴン outline / ハンドルは finish 描画の上、エクスポート時は編集 chrome を除外。

### 6. その他外装（LLM プロンプト記録）— サブ機能

- カテゴリ別（`ライティング` / `アクセント` / `館銘サイン` / `ポスト` / `外構-緑化` / `外構-舗装` / `門扉`）に**自由記述プロンプトを入力・保存**する。
- この change のスコープは **記録と仕様書出力のみ**。**画像生成 API 連携は行わない**（後続 change）。プロンプトは IndexedDB に保存され、Excel 仕様書と JSON に出力される。
- UI 上でも「画像には反映されません（仕様書に記録されます）」と明示する。

### 7. エクスポート

- 既存内観と**同じ操作感**の 1 クリック `外観仕様エクスポート`。同一 timestamp で PNG と Excel を出力する。
- PNG: 現在のアングルの合成結果を `pixelRatio: 2` でネイティブ相当解像度書き出し。編集ハンドル・outline は含めない。**全アングル一括**書き出しも可能にする。
- Excel: ゾーン一覧（アングル / ゾーン名 / 色番 / 色名 / カテゴリ / 不透明度 / 砂岩仕上げ有無）＋その他外装プロンプト一覧。色スウォッチを `worksheet.addImage` で inline 埋込（既存 `lib/export/spec-sheet.ts` と同じ `exceljs` 動的 import）。
- ファイル名: `specdrawing-ext-<projectSlug>-<angleSlug>-<YYYYMMDDHHmmss>.{png,xlsx}`（既存 `lib/export/filename.ts` を拡張）。

## Capabilities

### New Capabilities

- `exterior-project-workspace`: 外観モードの入口、ローカル画像アップロード（複数アングル）、案件の識別と切替、IndexedDB による永続化と復元、サーバ非送信の原則。
- `jolypate-color-catalog`: ジョリパッド PDF からの黄色ハイライト色番のみの抽出 seed、`jolypate-colors.json` のスキーマ・検証・ローダ、砂岩仕上げテクスチャ、カテゴリ別選択 UI。
- `facade-zone-editor`: 塗り分けゾーンのポリゴン作成／編集インタラクション規約（中点挿入・undo/redo・頂点操作）、ゾーンの CRUD と重なり順、production で動作すること。
- `facade-color-composition`: 白パースを shading とみなす前提での合成パイプライン（`multiply` × 不透明度 × even-odd clip）、1 ゾーン = 1 Layer、砂岩テクスチャ合成、描画順の不変条件。
- `exterior-extras-brief`: その他外装のカテゴリ定義とプロンプト記録、「画像には反映されない」ことの明示、仕様書への出力。

### Modified Capabilities

- `presentation-canvas`: 起動導線を「`/` で default scene 自動ロード」から「`/` はモード選択メニュー、内観キャンバスは `/exterior` と対になる専用ルート」に変更する。内観キャンバス自体の状態モデル・描画・パネル要件は不変。
- `project-export`: エクスポートの対象を内観（scene + variant）に加えて外観（project + angle）にも広げ、外観向けのファイル名規約と Excel 列構成、複数アングル一括書き出しを定義する。
- `dev-trace-tool`: ポリゴン編集インタラクション（中点挿入・undo/redo・頂点ヒット規約）を `/dev/trace` 専用実装から**共有コンポーネントに抽出**する。`/dev/trace` の外形挙動と dev/preview ゲートは不変であることを要件として固定する。

## Impact

### 新規

- ルート: `app/page.tsx`（モード選択メニューに置換）、`app/interior/page.tsx`（現 `app/page.tsx` の移設）、`app/exterior/page.tsx`、`app/exterior/ExteriorWorkspace.client.tsx`。
- 型・スキーマ: `lib/exterior/types.ts`（`ExteriorProject` / `ExteriorAngle` / `FacadeZone` / `ExtrasBrief`）、`lib/jolypate/schema.ts`、`lib/jolypate/load.ts`。
- 永続化: `lib/exterior/db.ts`（IndexedDB ラッパ。Blob + マニフェストの store 分離、スキーマ version と migration）。
- 状態: `lib/exterior/store.ts`（Zustand。内観 `lib/canvas/store.ts` とは**別 store**にして相互汚染を防ぐ）。
- 描画: `components/exterior/ExteriorCanvas.client.tsx`、`components/exterior/ZoneFillLayer.tsx`、`components/exterior/AngleSwitcher.tsx`、`components/exterior/ZoneList.tsx`、`components/exterior/JolypateColorPanel.tsx`、`components/exterior/OpacitySlider.tsx`、`components/exterior/ExtrasBriefPanel.tsx`、`components/exterior/ImageUploader.tsx`。
- ポリゴン編集の共有化: `components/polygon/PolygonEditor.tsx` ＋ `lib/polygon/interactions.ts`（`app/dev/trace/TraceTool.client.tsx` から中点挿入・頂点ヒット・undo/redo を抽出）。
- seed: `scripts/extract-jolypate-colors.mjs`、`package.json` に `seed:jolypate`。
- 生成物: `public/catalog/jolypate-colors.json`、`public/catalog/jolypate-colors.warnings.json`、`public/assets/jolypate/swatches/<code>.png`、`public/assets/jolypate/sandstone.jpg`（正規化済み）。

### 変更

- `app/page.tsx` — 内観キャンバスからモード選択メニューへ（中身は `app/interior/page.tsx` に移設）。
- `lib/export/filename.ts` — 外観向け `specdrawing-ext-…` 系のビルダーを追加（既存シグネチャは維持）。
- `lib/export/spec-sheet.ts` — 外観向けシート生成を追加（既存の内観出力パスは不変）。
- `lib/dev/history.ts` / `lib/parts/polygonOps.ts` / `lib/parts/hitTest.ts` — 外観からも使えるよう再エクスポート／汎用化（挙動は不変）。
- `app/dev/trace/TraceTool.client.tsx` — 抽出した共有コンポーネントを利用する形にリファクタ（外形挙動は不変）。
- `README.md` / `resources/reference/AUTHORING.md` — 外観モードの運用手順と「データはブラウザ内のみ」の明記。
- `.gitattributes`（LFS） — ジョリパッドスウォッチ PNG / 砂岩 JPG のパターン追加。

### 依存

- **新規ランタイム依存は無し**。Konva / Zustand / Zod / exceljs（既存）で完結。IndexedDB はブラウザ標準 API を薄いラッパで直接叩く。
- seed 側のみ `pdfjs-dist`（または `pdftoppm` 相当）でのページ画像化が必要。**devDependency に閉じる**（既存 `sharp` と併用）。

### 明示的な非スコープ

- その他外装の**画像生成**（LLM / 画像生成 API 連携）。この change はプロンプト記録と仕様書出力まで。
- 外観プロジェクトの**サーバ保存・URL 共有・複数端末同期**。IndexedDB のブラウザ内完結で始める。
- 内観モードの機能変更（ルート移設以外）。
- ジョリパッド以外の外装材（タイル・サイディング等）のカタログ。
