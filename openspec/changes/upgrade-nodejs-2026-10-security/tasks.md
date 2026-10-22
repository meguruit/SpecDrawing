## 1. 事前確認

- [x] 1.1 `main` から作業ブランチ（例 `chore/upgrade-nodejs-24`）を切り、`git status` がクリーンであることを確認する
- [x] 1.2 Vercel ダッシュボード → Project Settings → Build and Deployment → Node.js Version の現在値を確認し PR 説明に記録する（記録されていれば完了）
- [x] 1.3 Vercel の直近デプロイ一覧で、Node 20 deprecation による失敗が発生しているか確認し、エラーメッセージを PR 説明に記録する（記録されていれば完了）

## 2. バージョン宣言の更新

- [x] 2.1 `.nvmrc` を `20` → `24` に変更し、`nvm use` で `node -v` が `v24.22.1` 以上になることを確認する
- [x] 2.2 `package.json` `engines.node` を `">=20.0.0 <21"` → `"24.x"` に変更し、`.nvmrc` とメジャーが一致していることを目視確認する
- [x] 2.3 `devDependencies` の `@types/node` を `^20.16.10` → `^24` 系に更新し、`npm install` 後に `package-lock.json` の差分が `@types/node`（とその依存）に限られることを確認する

## 3. ローカル検証（Node 24）

- [x] 3.1 Node 24 で `rm -rf node_modules && npm ci` を実行し、`sharp` / `@napi-rs/canvas` を含めてエラーなく完了することを確認する（engines 不一致の警告が出ないこと）
- [x] 3.2 `npm run lint` と `npm run typecheck` が通ることを確認する
- [x] 3.3 `npm run build` が成功することを確認する
- [x] 3.4 `npm run start` で `/`・`/interior`・`/exterior` を開き、内観パースの表示・仕上げ切替、外観パースの表示が従来どおり動作することを確認する
- [ ] 3.5 （スキップ: main の seed スクリプトはいずれも追跡対象の `public/` 配下 PNG/JSON を書き換えるため実行せず。代わりに `sharp` 0.33.5 / libvips 8.15.3 を Node 24.22.1 でロードしメモリ上で PNG 生成できることを確認。`@napi-rs/canvas` は main には存在しない）ネイティブ依存を使う seed スクリプトを 1 本（例 `npm run seed:masks`）実行し、正常終了することを確認したうえで生成物の差分を破棄する（`git status` がタスク 2 の変更のみ）

## 4. Vercel 設定とプレビューデプロイ

- [x] 4.1 Vercel Project Settings の Node.js Version を `24.x` に変更し、保存後の表示が `24.x` であることを確認する
- [ ] 4.2 作業ブランチを push して PR を作成し、プレビューデプロイが成功することを確認する
- [ ] 4.3 プレビューのビルドログで Node バージョンが `v24.22.1` 以上であることを確認し、該当行を PR に貼る（ログに表示が無い場合は一時的に `buildCommand` 前で `node -v` を出す方法を検討し、恒久変更はしない）
- [ ] 4.4 ビルドログで LFS スモークチェック（`base_natural.jpg` が JPEG）が通っていること、`packageManager`（pnpm）関連の警告・エラーが出ていないことを確認する
- [ ] 4.5 プレビュー URL で 3.4 と同じスモーク（内観・外観・マスク PNG の `Cache-Control` ヘッダ）を行い、問題がないことを確認する

## 5. 本番デプロイ

- [ ] 5.1 PR を `main` にマージし、本番デプロイが成功することを Vercel ダッシュボードで確認する
- [ ] 5.2 本番のビルドログで Node バージョンが `v24.22.1` 以上であることを確認し、PR またはリリースノートに記録する
- [ ] 5.3 本番 URL で 3.4 と同じスモークを行い、問題がないことを確認する（問題時は design.md のロールバック手順で直前の本番デプロイを Promote する）

## Workflow follow-up

- 本番確認後、`openspec archive upgrade-nodejs-2026-10-security` で change をアーカイブし、`openspec/specs/vercel-deployment/spec.md` に要件が反映されたことを確認する。
- 24.x の EOL（2028-04-30）前に、Next の更新と合わせた次メジャー移行 change を起票する。
- `packageManager: pnpm@11.6.0` と npm 運用の食い違いを整理する別 change を検討する。

## 確認記録（2026-10-23）

- 1.1: worktree `SpecDrawing.wt-node24` に `origin/main`（812004d）から `chore/upgrade-nodejs-24` を作成。
- 1.2: `vercel project inspect spec-drawing --scope meguru-construction` → Node.js Version `24.x`（既に 24.x。変更不要）。
- 1.3: 直近デプロイは 106 日前（Ready）が最新で、Node 20 deprecation による失敗デプロイはまだ無い（push が無いため）。
- 2.x: `.nvmrc` 24 / `engines.node` "24.x" / `@types/node` ^24.19.2。lockfile 差分は `@types/node` 24.19.2 と `undici-types` 7.24.6 のみ。
- 3.1: Node v24.22.1 / npm 11.19.1 で `npm ci` 成功、EBADENGINE 警告なし（npm 11 の install-scripts 未許可警告: fsevents / sharp / unrs-resolver。sharp はプリビルドで動作）。
- 3.2: `npm run lint` 警告・エラーなし、`npm run typecheck` 成功。
- 3.3: `npm run build`（Next 14.2.35）成功。
- 3.4: `next start` で `/` 200、`/dev/trace` 200、`/catalog/finish-options.json` 200、`base_natural.jpg` 200 (image/jpeg)、`mask_01.png` 200。`/interior`・`/exterior` は main にルートが存在せず 404（変更前から同じ。ルートはフィーチャーブランチ側）。
- 4.1: Project Settings は既に `24.x`。
