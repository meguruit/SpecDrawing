## Why

本リポジトリは `.nvmrc` = `20`、`package.json` の `engines.node` = `">=20.0.0 <21"` で **Node.js 20 に固定**されている。Node 20 は 2026-04-30 に EOL を迎えており、2026-10-21 の Node.js セキュリティリリース（22.23.4 / 24.22.1 / 26.12.1、CVE 10 件のうち High 4 件 — Brotli デコーダ OOB write / RCE `CVE-2026-111497`、TLS ホスト名検証バイパス `CVE-2026-106069`、`dns.resolve` の NUL 切り詰め `CVE-2026-105482` ほか）の修正を **受け取れない**。

加えて Vercel は 2026-10-01 に Builds / Functions での Node 20 を deprecated にしており、既存デプロイは動き続けるものの **Node 20 のプロジェクトの新規デプロイはエラーになる**。`engines.node` は Project Settings より優先されるため、`main` への push による本番デプロイもプレビューデプロイも現状すべて失敗する（＝修正リリースすら出せない）。優先度は **P0**。

## What Changes

- 実行・ビルドに使う Node.js のメジャーを **サポート中の LTS **24.x**（Vercel 既定）** に引き上げる。
  - `.nvmrc`: `20` → `24`
  - `package.json` `engines.node`: `">=20.0.0 <21"` → `"24.x"`
  - （任意）`@types/node`: `^20.x` → `^24.x`（型定義を実行系に揃える）
- Vercel Project Settings の Node.js Version を `24.x` に揃える（`engines.node` が優先されるが、表示の食い違いによる誤解を防ぐ）。
- パッチ版は Vercel が自動ロールアウトするため、**ビルドログの `node -v` で修正版（24.22.1 以降）が使われていることを確認**する手順を仕様化する。
- 移行先を 22.x ではなく 24.x とした理由とトレードオフを design.md に記録する。
- アプリの機能・UI・API の挙動は変えない。

## Capabilities

### New Capabilities

（なし）

### Modified Capabilities

- `vercel-deployment`: ビルド／ランタイムの Node.js メジャーをサポート中の LTS に固定し、`.nvmrc` と `engines.node` を一致させること、およびデプロイ時にパッチ適用済みバージョンで動いていることを検証できることを要件として追加する。

## Impact

- **変更ファイル（実装時）**: `.nvmrc`、`package.json`（`engines.node`、任意で `@types/node`）、`package-lock.json`（`@types/node` を上げた場合のみ）。
- **Vercel**: Project Settings → Node.js Version。`vercel.json` の `installCommand` / `buildCommand` は変更しない。
- **依存**: Next `^14.2.35` / React 18 / `sharp` / `@napi-rs/canvas` などネイティブバイナリを含む依存が Node 24 で install・build できることを確認する必要がある。
- **ローカル開発**: 開発者は nvm 等で Node 24 に切り替える必要がある（`.nvmrc` 追従）。
- **リスク**: 低〜中。Next 14.2 の Node 24 互換性はローカル build / スモークと Vercel ビルドで実確認する（Next.js のメジャー更新が必要になった場合は本 change では行わず中断する）。ネイティブ依存（seed スクリプト用の `@napi-rs/canvas` / `sharp`）のプリビルドバイナリ有無を検証タスクで確認する。
