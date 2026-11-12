## 1. ルート移設とモード選択メニュー（内観の挙動を変えない）

- [x] 1.1 `app/page.tsx` の中身を `app/interior/page.tsx` へそのまま移設する（import パスのみ調整、ロジック差分ゼロ）
- [x] 1.2 `app/page.tsx` を 2 択のモード選択メニューに差し替える（「内観パースイメージ作成」→ `/interior`、「外観パース塗り分け」→ `/exterior`）。scene / parts / finish-options のフェッチも IndexedDB 接続も行わないこと
- [x] 1.3 `/interior` で既存内観スモークを通す（デフォルトシーン自動ロード / 17 マーカー / ⑦ 選択とチップ表示 / シート切替の選択保持 + トースト / バリアント切替 / 番号オーバーレイ OFF / 選択部材エクスポート）
- [x] 1.4 `/` がネットワークリクエストを一切出さないことを DevTools Network で確認する
- [x] 1.5 ここまでを独立コミットにする（単独 revert 可能にするため）

## 2. ポリゴン編集ロジックの共有化（`/dev/trace` を壊さない）

- [x] 2.1 `lib/polygon/interactions.ts` を新設し、`TraceTool.client.tsx` から純粋関数（`nearestEdge` / 垂線足計算 / 12px 判定 / 頂点ヒット判定 / 全リング横断の最近傍エッジ探索）を移設する。`TraceTool` は import するだけに変える
- [x] 2.2 `/dev/trace` スモーク: エッジ近傍クリックで中点挿入 / 遠方クリックで末尾追加 / hole のエッジ近傍クリックが hole に入る / 右クリック頂点削除 / 頂点ドラッグ
- [x] 2.3 `lib/dev/history.ts` を `lib/polygon/history.ts` へ移し、`lib/dev/history.ts` は re-export のみ残す（モード非依存化）
- [x] 2.4 `components/polygon/PolygonEditor.tsx` を切り出す。props は「編集対象 polygons / 変更コールバック / 表示スタイル / 選択状態」のみ。dev API・localStorage draft・regen への参照を一切持たないこと
- [x] 2.5 `TraceTool.client.tsx` を `PolygonEditor` 利用形にリファクタする。`/dev/trace` の外形挙動（autosave 600ms / draft 復元 / regen デバウンス / undo 30 段 / part 切替チェックポイント / ヘッダー高さ固定）は不変
- [x] 2.6 `/dev/trace` フルスモーク（2.2 に加えて autosave 保存済みバッジ / draft 復元プロンプト / マスク auto-regen / undo-redo 30 段 / 手動ダウンロード）
- [x] 2.7 dev/preview ゲートが変わっていないことを確認する（`/api/dev/parts` が production ビルドで 404）
- [x] 2.8 ここまでを独立コミットにする

## 3. ジョリパッドカラー seed

- [x] 3.1 `pdfjs-dist` を devDependency に追加し、`package.json` に `seed:jolypate` スクリプトを登録する
- [x] 3.2 `scripts/extract-jolypate-colors.mjs` — PDF 全 8 ページを 300 DPI でラスタライズし、同時に `getTextContent()` でテキスト item を bbox 付きで取得する
- [x] 3.3 黄色帯検出を実装する（HSV `hue ∈ [45°,65°] ∧ S > 0.45 ∧ V > 0.80` の連結成分のうち幅 > 30px・高さ 8–30px の横長矩形）
- [x] 3.4 帯とテキスト item の幾何マッチで色番を確定する（OCR は使わない）。帯に重なるテキストが無い場合は `orphan-band` 警告
- [x] 3.5 スウォッチ矩形（帯の直上・同幅・高さは帯幅の 0.9 倍）から 10% トリム平均で `colorHex` を算出する。サンプル不足は低信頼警告にして emit しない
- [x] 3.6 スウォッチ切り出しを `public/assets/jolypate/swatches/<code>.png`（128×128）へ書き出す
- [x] 3.7 カテゴリ解決を実装する（ページ見出し `NEUTRAL/MISTY/SUNNY/TRAD COLOR` から。見出しの無い続きページ（p.2）は直前のカテゴリを継承）
- [x] 3.8 索引ページ（p.8「カラー品番インデックス」）を解析し、`品番 / 色名 / ページ / カテゴリー / 座標` の台帳を作る。`nameJa` をここから取り込む
- [x] 3.9 自己検証を実装する — 抽出 code が索引に無ければ `unknown-code`、索引にあって未抽出のものを「黄色なしで意図的除外」か「抽出失敗」に分類。`抽出 N / 除外 M / 索引 148` が合わなければ非ゼロ終了
- [x] 3.10 `resources/catalog/jolypate-color-overrides.json`（任意）の読み込みを実装する（`colorHex` / `nameJa` / `include` を per-code で上書き、適用分をサマリに列挙。ファイル不在はエラーにしない）
- [x] 3.11 `public/catalog/jolypate-colors.json` と `public/catalog/jolypate-colors.warnings.json` を出力する。2 回連続実行で byte-identical になること（冪等性）を確認する
- [x] 3.12 砂岩テクスチャ正規化を同スクリプトに追加する（グレースケール化 + 平均輝度 0.5 + タイル可能な正方クロップ → `public/assets/jolypate/sandstone.jpg`。ソース JPG は書き換えない）
- [x] 3.13 `.gitattributes` に swatches PNG / sandstone.jpg の LFS パターンを追加し、生成物を commit する
- [x] 3.14 除外された色番の一覧を目視レビューする（`T6013` / `JP-100BK` / `JP-100SBK` / `JQ-200SBK` / `JQ-650SWH` / `T6401` / `T6405` / `T6404` / `T6010` / `T6702` 等が意図どおり除外されているか）

## 4. カタログのスキーマとローダ

- [x] 4.1 `lib/jolypate/schema.ts` — `{ code, category, page, colorHex, nameJa?, swatchUrl }` の Zod スキーマ。`colorHex` は `^#[0-9a-fA-F]{6}$` で検証
- [x] 4.2 `lib/jolypate/load.ts` — `jolypate-colors.json` をフェッチ・検証してロードする。検証失敗は `code` とフィールド名を名指しするエラーにし、部分適用しない
- [x] 4.3 カテゴリ別グルーピングとテキストフィルタ（`code` / `nameJa` 両方に一致）のヘルパを実装する

## 5. 外観データモデルと永続化

- [x] 5.1 `lib/exterior/types.ts` — `ExteriorProject` / `ExteriorAngle` / `FacadeZone` / `ExtrasBrief` の型と Zod スキーマ。ゾーンは `{ id, label, polygons: Polygon[], colorCode: string | null, opacity: number, finishTexture: "sandstone" | null }`。`polygons` は既存 `lib/parts/types.ts` の `polygonSchema` を再利用する
- [x] 5.2 `lib/exterior/db.ts` — IndexedDB ラッパ。`images` store（key: imageId、value: `{ blob, filename, width, height, byteSize }`）と `projects` store を分離する。`version: 1` と `onupgradeneeded` migration の骨格を用意する
- [x] 5.3 プロジェクト書き込みを 600ms デバウンスにする。1 頂点ドラッグで Blob が書き直されないことを確認する
- [x] 5.4 `lib/exterior/store.ts` — Zustand store。内観の `activeScene` / `parts` / `finishOptions` / `partFinishSelections` / `activeVariantKey` を一切持たないこと
- [x] 5.5 object URL のライフサイクル管理を実装する（アングル切替・アンマウント時に `revokeObjectURL`）
- [x] 5.6 `navigator.storage.estimate()` による使用量表示と 80% 超の警告（消費上位プロジェクトを名指し）

## 6. 外観ワークスペースの骨格

- [x] 6.1 `app/exterior/page.tsx` + `app/exterior/ExteriorWorkspace.client.tsx`（`next/dynamic({ ssr: false })` 境界。サーバ側で Konva / IndexedDB をモジュールスコープ参照しない）
- [x] 6.2 `components/exterior/ImageUploader.tsx` — ファイルピッカー + ドラッグ&ドロップ。JPEG/PNG 以外はファイル名と検出型を名指しして拒否し、保存しない
- [x] 6.3 長辺 4000px 超の画像を 4000px に縮小してから保存する。保存後の寸法がそのアングルのゾーン座標系になること
- [x] 6.4 プロジェクト CRUD（名前必須の作成 / 一覧 / 切替 / 確認付き削除。削除時に画像 Blob も回収）
- [x] 6.5 `components/exterior/AngleSwitcher.tsx` — アングルの切替・リネーム・確認付き削除。ゾーンがアングル間で混ざらないこと
- [x] 6.6 「このデータはこのブラウザにのみ保存されています」の常時表示
- [x] 6.7 リロード復元スモーク — 画像アップロード → リロード → 同じプロジェクト・アングル・ゾーンが復元される

## 7. ゾーン編集

- [x] 7.1 `components/exterior/ExteriorCanvas.client.tsx` — ベース画像をステージにフィット表示（内部座標は画像原寸のまま）
- [x] 7.2 `PolygonEditor` を組み込む。クリック頂点追加 / 12px 中点挿入 / 右クリック削除 / 頂点ドラッグが production ビルドで動くこと
- [x] 7.3 リングが 3 頂点未満にならないよう削除を拒否し、理由を表示する
- [x] 7.4 ゾーン CRUD（一意 id + 連番既定ラベル / 自由リネーム / 3 頂点以上のゾーン削除は確認必須）
- [x] 7.5 hole リングの追加と編集（穴の頂点も outer と同じ操作で編集可能）
- [x] 7.6 undo/redo（深さ 30 以上、頂点追加・削除・ドラッグ終了・リングクリア・ゾーン追加・ゾーン削除・ゾーン選択変更で 1 段。ドラッグ中 100 連発は 1 段）。ゾーン削除の undo で色も復元されること
- [x] 7.7 `components/exterior/ZoneList.tsx` — ラベル / 色番（未割当インジケータ）/ 不透明度を行表示。行クリックで選択、選択ゾーンをリストとキャンバス両方で強調
- [x] 7.8 ゾーンの並べ替え UI（並び順 = 重なり順）

## 8. 合成パイプライン

- [x] 8.1 `components/exterior/ZoneFillLayer.tsx` — 1 ゾーン = 1 `Konva.Group`（cache 済み）を単一 Layer に載せる。cache キーは描画依存フィールド（polygons / colorCode / opacity / finishTexture）の FNV-1a ハッシュ 1 本
- [x] 8.2 合成順を実装する: 色 Rect（`multiply` + zone.opacity）→ 砂岩テクスチャ（`soft-light`）→ マスク Shape（`destination-in`）。**クリップは必ず最後**
- [x] 8.3 マスク Shape を `sceneFunc` 内の `Path2D` + `ctx.fill(path, "evenodd")` で実装する（穴を even-odd で抜く。`clipFunc` は使わない）
- [x] 8.4 編集中（ドラッグ中）のゾーンは cache を外して直描きし、drag-end で再 cache する
- [x] 8.5 ゾーン隔離を検証する — 3 ゾーン描画時に 1 ゾーンのクリップが他ゾーンとベース画像を削らないこと。壊れる場合は design.md D4 のとおり 1 ゾーン = 1 Layer にフォールバックし、ゾーン数上限と警告を入れる
- [x] 8.6 `components/exterior/OpacitySlider.tsx` — 0–1 のスライダ + 数値表示、新規ゾーンの既定 0.85。変更が当該ゾーンのみ再描画すること
- [x] 8.7 砂岩テクスチャのタイル描画。継ぎ目が目立つ場合はミラータイル（4 象限鏡像）にフォールバックする
- [x] 8.8 未割当ゾーンがベース画像を一切変えないこと、かつ選択・編集は可能であることを確認する
- [x] 8.9 色クリアでベースが復元され、geometry / label / opacity / finishTexture が保持されることを確認する
- [x] 8.10 頂点ハンドル・アウトライン・選択強調がゾーン塗りの上に描かれること（濃色ゾーンでも見えること）

## 9. カラー選択 UI

- [x] 9.1 `components/exterior/JolypateColorPanel.tsx` — スウォッチ + 色番 + 色名のチップ。カテゴリ（NEUTRAL/MISTY/SUNNY/TRAD）でグルーピング
- [x] 9.2 色番・色名に対するテキストフィルタ
- [x] 9.3 チップクリックで選択中ゾーンに色を割り当て、即時再描画する
- [x] 9.4 ゾーン未選択時のクリックは「ゾーンを選択してください」を表示し、どのゾーンも変更しない
- [x] 9.5 実データスモーク — `駒込駅前_外観_1_20260807.jpg` をアップロードして外壁面にゾーンを引き、中明度色（例 `T3016`）を当てて陰影が残ることを確認する。ここで既定不透明度 0.85 の妥当性を判断し、必要なら調整する

## 10. その他外装（プロンプト記録）

- [x] 10.1 `components/exterior/ExtrasBriefPanel.tsx` — 固定 7 カテゴリ（`ライティング` / `アクセント` / `館銘サイン` / `ポスト` / `外構-緑化` / `外構-舗装` / `門扉`）の自由記述欄。カテゴリの追加・削除・リネーム UI は設けない
- [x] 10.2 「入力内容は画像には反映されません（仕様書に記録されます）」を常時表示する
- [x] 10.3 プロンプトをプロジェクト単位（アングル単位ではない）で保存し、`updatedAt` を記録する。リロードで復元されること
- [x] 10.4 LLM / 画像生成サービスへのリクエストも新規 API ルートも一切追加していないことを確認する

## 11. エクスポート

- [x] 11.0a `lib/export/download.ts` を新設 — blob object URL 経由のダウンロード、即時 revoke の廃止、複数ファイルの逐次配信（内観エクスポートで「ブラウザ上は成功するがファイルが落ちない」不具合の修正）
- [x] 11.0b `lib/export/stage-capture.ts` を新設 — ステージ登録 + `toCanvas` → `toBlob`（14MB の data URL を廃止）。PNG と Excel のダウンロード主体をページに一本化し、同一 tick での二重発火を解消
- [x] 11.1 `lib/export/filename.ts` に `buildExteriorExportFilename(projectSlug, angleSlug, ts, ext)` を追加する（既存 `buildExportFilename` のシグネチャは不変）。プロジェクト名・アングル名のファイルシステム安全な slug 化を実装する
- [x] 11.2 単一アングル PNG エクスポート（`pixelRatio: 2`、編集 chrome 除外）
- [x] 11.3 全アングル一括 PNG エクスポート（**逐次処理**。非アクティブアングルも自分のゾーンで合成されること。同一 timestamp を共有）
- [x] 11.4 `lib/export/spec-sheet.ts` に `downloadExteriorSpecSheet(...)` を追加する（`exceljs` 動的 import）。`塗り分け` シート: `アングル / ゾーン / 色番 / 色名 / カテゴリ / 不透明度 / 砂岩仕上げ / スウォッチ`、アングルでグループ化し重なり順で並べる
- [x] 11.5 スウォッチを `worksheet.addImage` で行高に合わせて inline 埋込する。未割当ゾーンは色列とスウォッチを空にして行自体は出す
- [x] 11.6 `その他外装` シート（`カテゴリ / 指定内容 / 更新日時`。空カテゴリは行を出さない）
- [x] 11.7 エクスポートボタンの活性制御（画像を持つアングルが 0 件なら無効。画像あり・ゾーン 0 件なら有効）
- [x] 11.8 内観エクスポートが無変更であることを回帰確認する（`選択部材` シート名 / 列構成 / `選択状態` の解決 / ファイル名パターン）

## 12. 案件 JSON 書き出し / 読み込み

- [x] 12.1 画像バイナリを含まない `<projectSlug>.specdrawing-ext.json` の書き出し（案件名 / アングル定義（元ファイル名 + 保存寸法）/ ゾーン / 色 / 不透明度 / 砂岩 / プロンプト）
- [x] 12.2 読み込み時にアングルごとの画像再添付を求める UI
- [x] 12.3 寸法不一致の画像を両方の寸法を名指しして拒否する（ゾーン座標が画像ピクセル座標系のため）
- [x] 12.4 往復スモーク — 書き出し → プロジェクト削除 → 読み込み + 画像再添付 → ゾーンが元どおり画像に一致すること

## 13. 仕上げ

- [x] 13.1 `README.md` に外観モードの操作手順と「データはこのブラウザにのみ保存される」旨、および `seed:jolypate` の実行手順を追記する
- [x] 13.2 `resources/reference/AUTHORING.md` に外観ワークフロー（アップロード → ゾーン作成 → 色割当 → エクスポート）と案件 JSON によるバックアップ運用を追記する
- [x] 13.3 `openspec/OVERVIEW_JA.md` に本 change のサマリを追記する
- [x] 13.4 production ビルド（`npm run build`）が通り、`/`・`/interior`・`/exterior` が SSR エラーなく描画されることを確認する
- [x] 13.5 通しスモーク — `/` → 外観 → 2 画像アップロード → 各アングルにゾーン作成 → ジョリパッド色割当 → 不透明度調整 → 砂岩 ON → その他外装プロンプト入力 → 全アングル PNG + Excel エクスポート → リロードして全状態が復元されること
