## Why

仕上げオプションは切り替え画像(variant: natural/flat/sharp)ごとに `textureUrlByVariant` / `colorHexByVariant` で見た目を出し分けられるが、パーツの **mask だけが variant 非対応** で全 variant 共通の1枚になっている。パースが異なる variant では同じパーツでも画面上の領域がズレるため、共通 mask だと塗りが base 画像とずれる。mask を variant ごとに切り替えられるようにして、既存の `〜ByVariant` 流儀に揃える。

## What Changes

- パーツマニフェスト(`parts.json`)に variant 別 mask を追加する:
  - `maskByVariant?: Record<variantKey, filename>` — 描画・存在 probe で参照する variant 別 mask ファイル名。
  - `maskPolygonsByVariant?: Record<variantKey, Polygon[]>` — 各 variant の mask PNG をラスタライズする生成元ポリゴン。
  - どちらも未指定の variant は既存の `mask` / `polygons` にフォールバックする(後方互換)。
- 描画(`PartFinishLayer`)の mask URL 解決を `part.maskByVariant?.[activeVariantKey] ?? part.mask` に変更。`textureUrlByVariant` と同じ解決パターン。
- **クリック判定(hit-test)とマーカー位置は全 variant 共通のまま**。variant 別になるのは見た目の塗り領域(mask)だけで、パース差によるクリック位置のズレは許容する(割り切り)。
- 開発用 regen(`/api/dev/parts/regen` ＋ `regenAssets`)を variant ループ対応にし、`maskPolygonsByVariant[key]` から `maskByVariant[key]` の PNG を自動生成する。
- `/dev/trace` オーサリング UI に variant 切り替え対応の polygon 編集導線を追加し、variant 別の mask 生成ポリゴンを描けるようにする。
- 仕上げオプション(`finish-options.json`)のアイテムに任意の `mask` を追加する:
  - アイテムに `mask` が定義されている場合のみ、そのオプションを適用したパーツのマスクは **active variant に関係なく** その `mask` を最優先で使用する(`maskByVariant` も `part.mask` も上書き)。`mask` 未定義のアイテムは従来どおり part 側(`maskByVariant[active] ?? part.mask`)で解決する。
  - `mask` は web ルートからの完全パス(例 `/assets/base/main/mask_14__sharp.png`)として runtime がそのまま読み込む(`resolveAssetUrl` のシーン相対解決は通さない)。既存の PNG を読み込むだけで、PNG 生成(regen 連携)は伴わない。`mask` のみで合成が完結し、生成元ポリゴンは持たない。
  - 予約センチネル `mask: "no"`: マスク合成自体を無効化する。**texture モード限定**で、`destination-in` クリップ工程を丸ごとスキップし、option のテクスチャ PNG を(`textureBox` があればその座標で)そのまま描画する。すでに形状が確定している PNG をクリップなしで出したいアイテム向け。color モードでは `"no"` は無視し、従来どおり part マスク(`maskByVariant[active] ?? part.mask`)で解決する(カラー塗りはクリップ用マスクが必須なため)。
- **パーツ毎のデフォルト選択** を新カタログ `public/catalog/default-options.json`(任意・後方互換)で定義する:
  - 形状はシート(ブランド)先頭: `{ version: 1, sheet: [{ id: <sheetName>, parts: [{ id: <partId>, default: <optionId>, [<baseKey>]: <optionId> }] }] }`。シート毎にそのシートでの各パーツの初期選択オプション id を指定する(シート毎に default を定義)。
  - **ベース(variant)毎のデフォルトも任意で指定できる**。パーツエントリは必須の `default` に加え、ベースキー(= scene の variant キー、例 `sharp`)→ option id の任意エントリを持てる。アクティブなベースに一致するキーがあればその option を、**見つからなければ `default`** を適用する。variant 無効/ベース未指定のシートは常に `default`。例: `{ "id": "14", "default": "14-urb-0-opt0", "sharp": "14-urb-syn-ブラック" }`。
  - ランタイムは内部で `PartSheetDefaults = Record<PartId, Record<SheetName, { default: FinishOptionId; byBase: Record<BaseKey, FinishOptionId> }>>` に正規化する。あるパーツ・シートの実効デフォルトは `byBase[activeBase] ?? default` で解決する(`resolveSheetDefault`)。
  - ここに定義されたパーツのみ、初期状態が「未選択」ではなくアクティブシート・アクティブベースの実効デフォルトを**選択済み**にしてスタートする。定義されないパーツは従来どおり「未選択」スタート。
  - 「クリア」ボタンは **実効デフォルト以外を選択している時のみ** 表示する。押下するとアクティブシート・アクティブベースの実効デフォルトに戻す(未選択にはしない)。デフォルト未定義パーツのクリアは従来どおり選択を解除する。
  - シート切替時、デフォルトのまま/未選択(=ユーザーが触っていない)のパーツは新アクティブシートの実効デフォルトに追従する。明示的に非デフォルトを選んだパーツのみ従来の `(partId, label)` 一致保持を行い、一致しなければそのシートの実効デフォルト(無ければ選択解除+通知)に落ちる。
  - **ベース切替時**も同様に、デフォルトのまま/未選択のパーツは新ベースの実効デフォルトに追従する(同一シート内なので明示選択はそのまま保持、通知なし)。
  - 読み込み時、各 `default` および各ベース override の option id が finish-options 上に存在し・同 partId・同 sheet・part の `renderMode` 整合であることを cross-validate する(不整合は part/sheet/baseKey/option を名指してエラー)。`default-options.json` 不在(404)は許容し、全パーツ従来どおり未選択スタート。
- **選択部材エクスポートの「選択状態」** を default-options 連動にする:
  - default 付きパーツは初期状態で実効デフォルトが**選択済み**としてシードされるため、エクスポート時点で `partFinishSelections` に値が入る。これを従来どおり一律 `"選択"` と出力すると、ユーザーが能動的に変えたものとデフォルトのままのものが区別できない。
  - 明示選択が存在しても、その option id が当該パーツ・シート・アクティブベースの実効デフォルト(`resolveSheetDefault(partSheetDefaults[partId][sheet], activeBase)`)と一致する場合は `"選択"` ではなく `"既定"` を出力する。一致しない(=ユーザーがデフォルトから変更した)場合のみ `"選択"`。
  - default 未定義のパーツや明示選択なしのパーツの従来挙動(`"選択"` / `"既定"`(シート先頭/variant default フォールバック)/ `"対象外"`)は不変。エクスポートに `partSheetDefaults` を受け渡す配線のみ追加。

## Capabilities

### New Capabilities
<!-- なし。既存ケイパビリティの要件変更のみ。 -->

### Modified Capabilities
- `numbered-part-overlay`: パーツマニフェストのスキーマに `maskByVariant` / `maskPolygonsByVariant` を追加し、未指定時のフォールバックと存在 probe の要件を定義する。
- `color-composition`: mask 合成パイプラインの mask 解決を、アクティブ variant の `maskByVariant` を優先しフォールバックする挙動に変更する。
- `dev-trace-tool`: `/dev/trace` の編集 UI と regen に variant 別 mask ポリゴンの編集・生成要件を追加する。
- `finish-spec-catalog`: 仕上げオプションのエントリ形状に任意の `mask`(完全パス文字列)を追加し、`mask` 定義時の最優先解決を定義する。さらに新カタログ `default-options.json`(シート毎のパーツ既定選択)のデータソース・検証要件を追加し、シート切替時の選択保持要件を「デフォルト追従」を含む形に変更する。
- `presentation-canvas`: パーツ毎デフォルトの初期選択シードと、「クリア」ボタンの表示条件(非デフォルト選択時のみ)・押下時のデフォルト復帰挙動を定義する。
- `project-export`: 選択部材エクスポートの `選択状態` 列を、明示選択でもそれが実効デフォルトと一致する場合は `"既定"` を出力するよう変更する(default-options 連動)。

## Impact

- スキーマ/型: `lib/parts/types.ts`(`partSchema`、`Part`/`RawPart`、`normalizePart`)、`lib/finishes/schema.ts`(`finishOptionSchema` に optional `mask`。`"no"` は予約センチネルとして許容、型は `z.string().min(1)` のまま。加えて `defaultOptionsFileSchema` のパーツエントリを `{ id, default }` + ベースキー catchall に拡張し、`PartSheetDefaults` の値型を `{ default; byBase }` に変更、`resolveSheetDefault` ヘルパを追加)。
- ローダ: `lib/parts/load.ts`(variant 別 mask の probe、`_rev` キャッシュバスタへのハッシュ追加)。option 側 `mask` は load 時 probe しない(`textureUrl` と同じ扱い)。`lib/finishes/load.ts` に `loadDefaultOptions`(404 許容。`default` とベース override を `{ default, byBase }` に正規化)＋ `crossValidateDefaultOptionsAgainstCatalog`(`default`・各ベース override の option 存在・partId・sheet・renderMode 整合)。
- 状態: `lib/canvas/store.ts`(`partSheetDefaults` の値型を `{ default; byBase }` に変更、`loadScene` の初期シードと `setActiveSheet` のデフォルト追従を `resolveSheetDefault(…, activeBase)` 解決に変更、`setActiveVariantKey` でベース切替時のデフォルト追従を追加、クリア時のデフォルト復帰)。
- UI: `components/finishes/FinishOptionPanel.tsx`(「クリア」の表示条件＝実効デフォルト選択時のみ／押下で実効デフォルト復帰。`activeVariantKey` を読んで `resolveSheetDefault` で解決)。`app/page.tsx`(`loadDefaultOptions` 呼び出しと `loadScene` への受け渡し)。
- 描画: `components/parts/PartFinishLayer.tsx`(mask URL 解決 — option `mask` を最優先。`"no"`(texture モード)では `maskUrl` を `null` にして `destination-in` を描画しない)。
- エクスポート: `lib/export/spec-sheet.ts`(`buildSpecSheetRows` / `buildSpecSheetWorkbook` / `downloadSpecSheet` に任意の `partSheetDefaults` 引数を追加し、明示選択 == 実効デフォルトを `"既定"` 判定)。`app/page.tsx`(`downloadSpecSheet` 呼び出しに `state.partSheetDefaults` を受け渡し)。
- 開発ツール: `lib/dev/regenAssets.ts`、`app/api/dev/parts/regen/route.ts`、`/dev/trace` オーサリング UI。
- アセット: `public/assets/base/<scene-id>/` に variant 別 mask PNG が追加される。
- 後方互換: `maskByVariant`/`maskPolygonsByVariant` 未指定の既存パーツは従来どおり単一 mask で動作する(破壊的変更なし)。`mask` 未指定の既存オプションも従来どおり part マスクで解決する(破壊的変更なし)。`default-options.json` 不在時は全パーツ未選択スタートで従来挙動を維持(破壊的変更なし)。
