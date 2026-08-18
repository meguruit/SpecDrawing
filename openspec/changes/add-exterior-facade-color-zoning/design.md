## Context

SpecDrawing は現在、**commit 済みの内観ベースパース**を前提に組み上がっている。`public/assets/base/<sceneId>/scene.json` に登録されたシーン、`parts.json` の固定 17 部材、`npm run seed:masks` がサーバ側 `sharp` でラスタライズした `mask_NN.png` / `shading_NN.png`、そして `部材リスト.xlsx` 由来の `finish-options.json`。この 4 点セットが揃って初めて 1 枚のパースが描ける。

外観パースはこの前提をすべて外れる。

| | 内観（現行） | 外観（本 change） |
|---|---|---|
| 画像 | commit 済み・全案件共通 | **案件ごとの一点物**・ユーザーがその場でアップロード |
| 領域定義 | `parts.json`（commit 済み・番号固定） | **その場でクリックして描く**・案件ごとに任意個 |
| マスク | seed が PNG を事前生成 | **事前生成できない**（画像が commit されていないため） |
| 陰影 | `shading_NN.png` を seed が抽出 | **ホワイトパースに既に焼き込まれている** |
| 仕上げ候補 | `部材リスト.xlsx`（案件ごとに変わる） | **ジョリパッド全色共通**（カタログ固定） |

つまり「seed パイプラインで事前に固める」という現行の中核戦略が外観では使えない。事前生成の代わりに **すべてをブラウザ内で完結させる**（IndexedDB 永続化 + Konva によるランタイム clip）方針を採る。これはユーザーとの合意事項でもある。

同時に、既存の内観フローは実運用に入っているため **一切壊さない**ことが絶対条件。したがって新モードは別ルート・別 store・別 capability として切り、既存コードへの変更は「ルート移設」と「ポリゴン編集ロジックの共有化リファクタ」に限定する。

参考実データ: `/Users/tato/Downloads/駒込駅前_fb77420c_20260818/` の 2 ファイル（2500×2273 の白模型調 CG、外壁は純白に近く、庇下・植栽に灰色の陰影が乗っている）。

## Goals / Non-Goals

**Goals:**

- `/` をモード選択メニューにし、内観（`/interior`）と外観（`/exterior`）を対等な 2 モードとして提供する。既存内観機能は挙動不変。
- ローカルのホワイトパース画像を、サーバに一切送らずにアップロード・複数アングル管理・IndexedDB 永続化できる。
- ジョリパッド PDF の **黄色ハイライト色番のみ**を機械的に抽出し、再現可能な seed でカタログ化する。
- `/dev/trace` で確立したポリゴン編集の操作規約（中点挿入 12px・undo/redo 30 段・頂点 Circle だけ listening）を **production で動く共有コンポーネント**として再利用する。
- 白パースの陰影を活かした合成（`multiply` × 不透明度）を、マスク PNG を一切生成せずに実現する。
- その他外装の指定をカテゴリ別プロンプトとして記録し、PNG + Excel を既存と同じ 1 クリック操作で書き出す。

**Non-Goals:**

- その他外装の**画像生成**（LLM / 画像生成 API 連携）。本 change は記録と仕様書出力まで。
- 外観プロジェクトの**サーバ保存 / URL 共有 / 複数端末同期**。
- 内観モードの機能変更（`/` → `/interior` のルート移設以外）。
- ジョリパッド以外の外装材カタログ（タイル・サイディング等）。
- 外観側での variant（natural/flat/sharp）概念。外観のベース画像はユーザーが持ち込む 1 枚がすべて。
- ポリゴンの自動抽出（エッジ検出 / セグメンテーション）。本 change は手動トレースのみ。

## Decisions

### D1. 内観 store を拡張せず、**別ルート + 別 Zustand store** に分離する

`lib/canvas/store.ts` は `activeScene` / `parts` / `finishOptions` / `partFinishSelections` / `activeVariantKey` など、**内観のデータモデルに強く結合**している。ここに外観の概念（project / angle / zone / uploaded blob）を混ぜると、`presentation-canvas` の既存要件「store に `placedMaterials` / `axisFilters` / `partColors` が存在しないこと」と同種の腐敗を再生産する。

- 外観は `lib/exterior/store.ts` に独立した Zustand store を置く。
- 共有するのは**純粋関数のみ**（`lib/parts/hitTest.ts`、`lib/parts/polygonOps.ts`、`lib/parts/types.ts` の `polygonSchema`、`lib/dev/history.ts`）。状態は共有しない。
- ルートで物理分離するので、内観ページが外観 store を import することも逆もない。

*代替案*: 単一 store に `mode: "interior" | "exterior"` を持たせる。→ 却下。片方のリファクタが他方を壊すリスクを恒久的に抱え込む。分離のコストは store ファイル 1 個ぶんで済む。

### D2. IndexedDB は **Blob store とマニフェスト store を分ける**

1 つのオブジェクトに画像バイナリと編集状態を同居させると、ポリゴンを 1 頂点動かすたびに 5 MB の Blob を読み書きすることになる。

- `images` object store: key = `imageId`（UUID）、value = `{ blob: Blob, filename, width, height, byteSize }`。**書き込みはアップロード時の 1 回だけ**。
- `projects` object store: key = `projectId`、value = `ExteriorProject`（画像は `imageId` 参照のみ持つ）。編集のたびに更新するのはこちら。
- 表示は `URL.createObjectURL(blob)` で得た object URL を `useImageCache` 相当に食わせる。**object URL はアングル切替時に `revokeObjectURL` する**（リークすると 2500×2273 の decode buffer がタブに積み上がる）。
- DB は `version` を持ち、`onupgradeneeded` で migration する。初版は `version: 1`。
- 書き込みは 600 ms デバウンス（`/dev/trace` の autosave と同じ間隔・同じ思想）。

*代替案*: 画像を base64 で `localStorage` に入れる。→ 却下。localStorage は 5–10 MB 上限で、2500 px の JPG 2 枚で即死する。

### D3. マスク PNG を作らず、**`destination-in` の「マスク Shape」**でクリップする

現行の描画不変条件は「mask 画像を `destination-in` で**最後に**当てる」。外観ではその mask 画像が存在しないので、**同じ合成位置に mask 画像の代わりにポリゴンを塗る `Konva.Shape` を置く**。

```
zone group（cache 済み）:
  1. 色 Rect        … globalCompositeOperation: "multiply", opacity: zone.opacity
  2. 砂岩テクスチャ  … （sandstone: true のときのみ）"soft-light"
  3. マスク Shape    … globalCompositeOperation: "destination-in"   ← 必ず最後
```

マスク Shape は `sceneFunc` の中で `Path2D` を組み立て、**`ctx.fill(path, "evenodd")`** で塗る。even-odd を明示するのは `polygons[].holes` を穴として抜くため（既存 `polygonSchema` は multi-ring 対応済み）。Konva の `Container.clipFunc` は内部で `ctx.clip()` を呼ぶだけで fill rule を渡せないため採用しない。

この構造は既存の `PartFinishLayer` と描画順・合成演算が完全に一致するので、「mask は最後」の不変条件がモード横断で 1 本に保たれる。

*代替案 A*: クライアントで `OffscreenCanvas` にマスク PNG を焼いてから既存パスに流す。→ 却下。1 頂点動かすたびに 2500×2273 のラスタライズが走る。
*代替案 B*: `clipFunc`。→ 却下。穴（even-odd）が表現できない。

### D4. **1 ゾーン = 1 cached Group**（Layer ではなく Group）

内観は「1 part = 1 Layer」だが、これは part が 17 個固定だから成立している。外観のゾーン数は案件次第で 20〜40 になり得る。Konva は Layer ごとに DOM `<canvas>` を 1 枚持つので、Layer 数が増えると合成コストとメモリが線形に膨らむ（Konva 公式も 3〜5 Layer 推奨）。

- 全ゾーンを **1 枚の Layer** に載せ、ゾーンごとに `Konva.Group` を作って **`group.cache()`** する。
- cache された Group は自前のオフスクリーンキャンバスを持つため、その中の `destination-in` は **Group 内に閉じ、兄弟ゾーンや base 画像を削らない**。これが Layer 分割と同じ隔離を、1/N のコストで得る肝。
- cache は「そのゾーンの polygons / colorCode / opacity / sandstone が変わったとき」だけ再実行する（依存キーのハッシュで判定）。**編集中（ドラッグ中）のゾーンは cache を外して直描き**し、drag-end で再 cache する。
- 重なり順は Group の zIndex = ゾーン配列順。UI の並べ替えがそのまま重なり順になる。

*リスク*: cache のライフサイクル管理を誤ると「色を変えたのに反映されない」という現行 `_rev` キャッシュバスト問題と同型のバグを生む。→ 実装で cache キーが取り回せないと判明した場合は **1 ゾーン = 1 Layer にフォールバック**し、ゾーン数に上限（例 24）を設けて警告する。仕様上どちらでも要件は満たせるようにする（要件は「あるゾーンの clip が他ゾーンの描画結果を削らないこと」で書く）。

### D5. 色は **`multiply` × 不透明度**、白パースをそのまま shading とする

ホワイトパースの外壁はほぼ純白（RGB ≒ 250 前後）で、庇下や陰面だけが暗い。純白に `multiply` を掛けると **色そのもの**が出て、陰面には **色 × 暗さ** が出る。つまり白パースは既に理想的な shading マップになっている。`shading_NN.png` に相当する資産は不要。

- `opacity` はゾーンごとに 0–1 のスライダ、**既定 0.85**。1.0 では白パースの微細な質感（テクスチャノイズ・アンビエントオクルージョン）が飛びやすく、0.85 前後が実物に近いという想定値。
- ゾーンパネルに「不透明度」を数値 + スライダで出し、打合せの場で即調整できる。
- `filter: hue-rotate` は使わない（既存不変条件と同じ理由：輝度・彩度が保てない）。

### D6. ジョリパッド PDF は **テキストレイヤ × 黄色帯の幾何マッチ**で抽出する（OCR なし）

PDF は Quartz 生成でテキストレイヤを持つ。したがって色番は**文字認識せずに正確に読める**。

抽出アルゴリズム（`scripts/extract-jolypate-colors.mjs`）:

1. 色番は `pdfjs-dist` の `getTextContent()` から取得（**OCR は使わない**）。ラスタは poppler の `pdftoppm` で 150 DPI の PNG にし、`sharp` で画素を読む。
2. 各色番ラベルの**自前の bbox 内**で黄色画素の割合を測る。閾値は 1%。
3. スウォッチ色は、ラベル**直上**の保守的な矩形（幅 = min(ラベル幅×1.6, 列ピッチ×0.6)、高さ 26pt）を **10% トリム平均**で集約する。ジョリパッドは骨材入りで粒状ノイズがあるため単純平均ではなくトリム平均を使う。
4. スウォッチ PNG は `colorHex` の単色タイル（128×128）を `public/assets/jolypate/swatches/<code>.png` に書き出す。印刷面の写真ではなく**実際に塗られる色**を出すのが目的（写真を出すと合成が再現しない質感を約束してしまう）。
5. カテゴリは**ページ → カテゴリの宣言マップ**で解決する。

**黄色でない色番は出力しない**。実データで除外されたのは `T6013` / `JQ-650SWH` / `JP-100SBK` / `JQ-200SBK` / `JP-100BK` / `T6401` / `T6405` / `T6404` / `T6010` / `T6702` の 10 件（要件で挙げられた調色不可・特注色と完全一致）。

*代替案*: OCR（tesseract）。→ 却下。テキストレイヤがあるのに OCR を挟むのは精度・依存の両面で損。

**実装時の改訂（当初案からの変更）**

- **黄色帯をベクタ演算子から読む案は破棄した。** 当初は `getOperatorList()` の塗り矩形を直接読む案（ラスタ不要・厳密）を試したが、一部ページのハイライト矩形が入れ子の form XObject 内にあり、演算子レベルでは変換行列がきれいに合成できなかった（ページ 1・5 が正しく解決できる実装がページ 2〜4 をずらす）。ラスタにはこの曖昧さが無いため、**ラスタ判定**を採用する。
- **ラスタライザは `pdftoppm`（poppler）**。`pdfjs-dist` + `@napi-rs/canvas` でのレンダリングは、pdfjs のグリフ描画が `ctx.fill(path)` を呼ぶところで napi-rs 側と噛み合わず失敗する。poppler はシステム依存が増えるが、seed はメンテナのみが稀に走らせる工程であり、未インストール時は導入方法を名指しして落とす。
- **カテゴリ見出しの自動検出は当てにならない。** ページ 4・5 の見出しは字送りされたテキスト（`"M I S T Y"` + `"COLOR"`）として読めるが、**ページ 6 の TRAD 見出しはアウトライン化されていてテキストレイヤに存在しない**。そのため宣言マップを正とし、読める見出しとの不一致は例外で落とす（構成変更の検知は維持）。
- **スウォッチ判定は「グリッド行」で行う。** 凡例表（`JQ-810` 等）は 1 行 1 色番、スウォッチは 4 列または 6 列。同一ベースラインを共有する色番が 3 個以上ある行だけをスウォッチ行とみなす。ページ上の位置に依存しないので堅い。

### D7. 索引ページは使えない — **取りこぼしゼロの会計検査**を不変条件にする

当初は索引ページ（p.8「カラー品番インデックス」）を ground truth にして 148 色と突き合わせる設計だった。**これは実データで不可能と判明した**: 索引ページは `showText` 演算子を 932 個持つ一方、テキストレイヤから取り出せる文字列は 1 個だけ（フォントに ToUnicode マップが無い）。OCR 無しには読めない。

代わりに、**より本質的で検証可能な不変条件**を置く。

- **会計検査**: テキストレイヤが返した色番ラベルは、1 つ残らず「出力された」か「理由付きで warnings に記録された」かのどちらかでなければならない。合わなければ非ゼロ終了。「黙って色が減る」という当初の懸念は、索引照合ではなくこれで潰れる。
- カタログ記載の「全 148 色」は**参考値としてログ出力するだけ**にする。実測の distinct 色数は 144 で、差分はページ 7 のビビッドカラー（特注限界色）等の数え方に由来する。再現できない数字をハード検査に使うと、正しい抽出まで落としてしまう。
- 副作用として **`nameJa` は PDF から取得できない**（索引にも、TRAD ページの色名にもテキストレイヤが無い）。schema 上 optional のままとし、必要ならデザイナー override で与える。

実測サマリ: 色番ラベル 168 個すべてを分類 / distinct 144 色 / 出力 134 色 / 非ハイライト除外 10 色。

機械抽出をどうしても上書きしたい場合のために `resources/catalog/jolypate-color-overrides.json`（デザイナー所有・任意）を用意し、`colorHex` / `nameJa` / `include` を per-code で上書きできるようにする（既存 `finish-base-overrides.json` と同じ運用思想）。索引が読めない以上、`nameJa` を入れる唯一の経路でもある。

### D8. `/dev/trace` からの共有化は **純粋関数 → コンポーネント** の順で行い、外形挙動を変えない

`app/dev/trace/TraceTool.client.tsx` は 1790 行あり、一気に切り出すと内観オーサリングを壊す。

1. まず**純粋関数**を `lib/polygon/interactions.ts` に抽出する（`nearestEdge` / 垂線足計算 / 12px 判定 / 頂点ヒット判定）。`TraceTool` はそれを import するだけに変える。挙動差分ゼロで検証しやすい。
2. 次に `lib/dev/history.ts` を `lib/polygon/history.ts` に移し（`lib/dev/history.ts` は re-export を残す）、モード非依存にする。
3. 最後に React の編集レイヤ `components/polygon/PolygonEditor.tsx` を切り出す。props で「編集対象 polygons / 変更コールバック / 表示スタイル」を受け、**dev 依存（`/api/dev/parts`・localStorage draft・regen）は一切持たない**。`/dev/trace` はこのコンポーネント + dev 固有の永続化層、外観は同コンポーネント + IndexedDB 永続化層、という構成にする。
4. `/dev/trace` の **dev/preview ゲートは触らない**。`PolygonEditor` 自体はゲートの外に置くので production の外観モードで動く。

### D9. 砂岩仕上げは **色の上に乗せる質感レイヤ**として扱う（色の置換ではない）

`ジョリパッド砂岩仕上.jpg` は「仕上げのテイスト（骨材の粒状感・凹凸）」であって色ではない。ジョリパッドは同じ色番で複数の仕上げパターンを選べる商材なので、**色 × 仕上げの直交**が正しいモデル。

- seed（`seed:jolypate` の一部）が JPG を**グレースケール化 + 平均輝度 0.5 に正規化 + タイル可能な正方クロップ**して `public/assets/jolypate/sandstone.jpg` を出力する。
- ランタイムは `Konva.Image` を `fillPatternRepeat` 相当でタイルし、`globalCompositeOperation: "soft-light"` で色 Rect の上に重ねる。輝度 0.5 正規化により、テクスチャが無地の部分では色が変わらず、粒だけが乗る。
- ゾーンごとに ON/OFF（`sandstone: boolean`）。Excel 仕様書にも「砂岩仕上げ 有/無」列を出す。

### D10. エクスポートは既存 `lib/export/*` を**拡張**し、内観の出力パスは触らない

- `lib/export/filename.ts` に `buildExteriorExportFilename(projectSlug, angleSlug, ts, ext)` を追加。既存 `buildExportFilename` のシグネチャは不変。
- `lib/export/spec-sheet.ts` に `downloadExteriorSpecSheet(...)` を追加。`exceljs` の動的 import・`worksheet.addImage` によるスウォッチ inline 埋込という既存の作法をそのまま踏襲する。
- **全アングル一括 PNG** は、アングルを順に非表示ステージへロードして `toDataURL({ pixelRatio: 2 })` する逐次処理にする。並列にすると 2500 px × N 枚のデコードでメモリが跳ねる。
- Excel は 2 シート構成: `塗り分け`（アングル / ゾーン / 色番 / 色名 / カテゴリ / 不透明度 / 砂岩仕上げ / スウォッチ画像）と `その他外装`（カテゴリ / プロンプト / 更新日時）。

### D11. その他外装は**プロンプトを保存するだけ**で、LLM を呼ばない

- データは `ExtrasBrief = { category, prompt, updatedAt }[]`。カテゴリは固定 7 種（`ライティング` / `アクセント` / `館銘サイン` / `ポスト` / `外構-緑化` / `外構-舗装` / `門扉`）。
- API ルートも API キーも追加しない。したがって**この change ではサーバ側の新規エンドポイントがゼロ**になる（デプロイ面のリスクが無い）。
- UI に「入力内容は画像には反映されません（仕様書に記録されます）」を常時表示する。期待値のズレは、この機能で最も起きやすい事故なので UI に固定する。

### D12. 案件の **JSON 書き出し / 読み込み**をデータ喪失の逃げ道として用意する

IndexedDB はブラウザのキャッシュ削除・シークレットウィンドウ・端末変更で消える。顧客打合せ直前に消えると致命的なので、逃げ道を仕様に組み込む。

- `<projectSlug>.specdrawing-ext.json` を書き出す。中身は**画像を除く全状態**（案件名・アングル定義（元ファイル名 + 画像寸法）・ゾーン・色・不透明度・砂岩・プロンプト）。
- 読み込み時は、アングルごとに**元と同じ画像ファイルを再選択**させる。寸法が一致しない画像を選んだ場合は警告して拒否する（ポリゴン座標が画像ピクセル座標系なので、寸法が違うとゾーンが全部ズレる）。
- 画像を JSON に埋め込まないのは、2500 px の JPG 2 枚を base64 にすると 10 MB 超の JSON になり実用に耐えないため。

## Risks / Trade-offs

- **IndexedDB の容量枯渇** — 高解像度 JPG × 複数アングル × 複数案件で数百 MB に達し得る。→ `navigator.storage.estimate()` で使用量を表示し、80% 超で警告。案件単位の削除 UI を必須にする。アップロード時に「長辺 4000 px 超は 4000 px に縮小して保存」する（ポリゴン座標は保存後の寸法基準なので一貫性は保たれる）。

- **ブラウザ内完結ゆえのデータ喪失** — キャッシュ削除で全消滅。→ D12 の JSON 書き出し / 読み込み。加えて外観ワークスペースに「このデータはこのブラウザにのみ保存されています」を常時表示する。

- **PDF 抽出の脆さ** — カタログ改訂やレイアウト差で黄色帯検出が崩れると、色が黙って減る。→ D7 の索引照合を **seed の必須ステップ**にし、「索引 148 / 抽出 N / 除外 M」が合わない場合は非ゼロ終了する。加えて `jolypate-color-overrides.json` で人手の上書きを常時可能にする。

- **Group cache のライフサイクル** — cache キーの取りこぼしで「色を変えたのに反映されない」が起きる。既存の `_rev` キャッシュバストと同型の事故。→ cache キーはゾーンの描画依存フィールドだけを FNV-1a でハッシュした 1 本の文字列にし、`useEffect` の依存に直接置く。実装で不安定なら D4 のとおり 1 ゾーン = 1 Layer にフォールバックする。

- **大画像 × 多ゾーンの描画性能** — 2500×2273 のベース + 30 ゾーンの cache は初回描画が重い。→ ベース画像はステージにフィットさせて表示（内部座標は原寸のまま）、cache は表示解像度で取り、エクスポート時のみ `pixelRatio: 2` で焼く。

- **`/` のルート移設** — `/` を直接ブックマークしていた利用者は 1 クリック増える。→ メニューは 2 択のみの軽量ページにし、遷移コストを最小化する。挙動変更は README に明記。

- **共有化リファクタが `/dev/trace` を壊す** — 1790 行からの抽出はリグレッションの温床。→ D8 の 3 段階（純粋関数 → history → コンポーネント）で刻み、各段階の後に `/dev/trace` のスモーク（中点挿入・右クリック削除・undo/redo・autosave・regen）を通す。ポリゴン編集の共有化が危険と判明した段階で、**共有化を諦めて外観側に独立実装する**という撤退路も残す（要件はどちらでも満たせる書き方にしてある）。

- **`multiply` の限界** — ホワイトパースが純白でなく灰色がかっている領域（庇下・北面）では、濃色を当てると想定より暗く沈む。→ 不透明度スライダで現場調整可能にする。それでも足りない場合の「明度補正」は本 change の非スコープとし、必要なら後続 change で `Konva.Filters.Brighten` を検討する。

- **砂岩 JPG がタイル化に向かない可能性** — 継ぎ目が出る。→ seed でミラータイル（4 象限鏡像）を生成するオプションを持たせる。それでも目立つ場合は「単一タイルをゾーン bbox にフィットさせて拡大」にフォールバックする（質感の粒径は狂うが継ぎ目は出ない）。

## Migration Plan

1. **ルート移設（挙動不変）** — `app/page.tsx` を `app/interior/page.tsx` へそのまま移動し、`app/page.tsx` を 2 択メニューに差し替える。この時点で内観スモーク（既存 `OVERVIEW_JA.md` §5 の 7 項目）を `/interior` で通す。
2. **ポリゴン編集の共有化** — D8 の 3 段階。各段階後に `/dev/trace` スモーク。
3. **ジョリパッド seed** — `scripts/extract-jolypate-colors.mjs` + `npm run seed:jolypate` を追加し、`jolypate-colors.json` / `swatches/` / `sandstone.jpg` を生成。索引照合サマリが「148 / N / M」で整合することを確認して commit（生成物は LFS）。
4. **外観の骨格** — `lib/exterior/types.ts` / `db.ts` / `store.ts` と `/exterior` ルート、画像アップロード + アングル切替 + IndexedDB 永続化まで。この時点でリロード復元が効くことを確認する。
5. **ゾーン編集と合成** — `PolygonEditor` の組み込み、ゾーン CRUD、色パネル、不透明度、砂岩、cached Group 合成。
6. **その他外装 + エクスポート** — プロンプトパネル、PNG（単一 / 全アングル）、Excel 2 シート、案件 JSON 書き出し / 読み込み。
7. **ドキュメント** — README / AUTHORING.md に外観モードの手順と「データはブラウザ内のみ」を明記。

**Rollback**: 外観側は完全に新規ファイル + 新ルートなので、`app/page.tsx` のメニュー化と `app/interior/` 移設を revert すれば元に戻る。共有化リファクタ（手順 2）だけは既存コードに触るため、独立コミットに分けて単独 revert 可能にしておく。

## Open Questions

- **不透明度の既定値 0.85** は実データでの見え方を確認して調整する。手順 5 のスモークで `駒込駅前_外観_1` に中明度色（例 `T3016`）を当てて決める。
- **砂岩以外の仕上げテイスト**（ジョリパッドは他にもパターンがある）を将来増やす前提で、`sandstone: boolean` ではなく `finishTexture: string | null` にしておくべきか。→ 本 change では拡張しやすい後者の形（`finishTexture: "sandstone" | null`）で持ち、UI はトグル 1 個に留める。
- **ゾーンの既定ラベル**（`ゾーン1` 等の連番か、`外壁-南面` のようなプリセットか）。実運用のヒアリング待ち。初版は連番 + 自由リネームとする。
- **索引ページのカテゴリー列と抽出カテゴリの不一致**が実データで出るか（ページ 2 は見出しの無い NEUTRAL 続きページなので継承ロジックに依存する）。手順 3 で実測して判断する。
