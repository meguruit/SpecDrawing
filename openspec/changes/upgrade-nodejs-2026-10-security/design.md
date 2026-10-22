## Context

動機は proposal.md「Why」を参照。設計に効く現状の制約だけを挙げる。

- Node のバージョン宣言は 2 箇所: `.nvmrc`（`20`）と `package.json` `engines.node`（`">=20.0.0 <21"`）。CI ワークフロー（`.github/`）は存在しない。
- Vercel ではメジャー（`24.x` 既定 / `22.x`）しか選べず、パッチは自動ロールアウト。`engines.node` が Project Settings より優先される。
- `vercel.json` の `installCommand` は `git lfs install --force && git lfs pull && npm install && <LFS スモークチェック>`、`buildCommand` は `next build`。リポジトリには `package-lock.json` のみがあり、一方で `package.json` には `packageManager: pnpm@11.6.0` が書かれている（実際のインストールは npm）。
- フレームワーク: Next `^14.2.35`、React 18。ネイティブバイナリを含む依存: `sharp ^0.33.5`、`@napi-rs/canvas ^1.0.7`（いずれも devDependencies、seed スクリプト用）。
- `test` スクリプトは無い。検証手段は `lint` / `typecheck` / `build` と手動スモーク。

## Goals / Non-Goals

**Goals:**
- Vercel の新規デプロイ（プレビュー・本番）を再び通す。
- 2026-10-21 のセキュリティ修正を含むパッチ版の Node で build / 実行されることを確認できる状態にする。
- ローカル（`.nvmrc`）と Vercel（`engines.node`）のメジャーを一致させる。

**Non-Goals:**
- Next.js 15 以降へのアップグレード、React 19 化。
- npm ↔ pnpm のパッケージマネージャ整理（Open Questions に記録のみ）。
- `vercel.json` の install / build コマンド変更。

## Decisions

### Decision 1: 移行先メジャーは 24.x（ユーザー決定）

| 観点 | 22.x | 24.x |
|---|---|---|
| サポート期限 | Maintenance LTS、2027-04-30 まで | LTS、2028-04-30 まで |
| Vercel | 選択可 | 既定値 |
| 今回の修正版 | 22.23.4 | 24.22.1 |
| TLS ホスト名バイパス `CVE-2026-105483` | 対象外（24/26 のみ） | 対象（修正版で解消） |
| Next 14.2 との相性 | 対応範囲内、実績多い | 互換性確認が必要（ローカル build / スモーク・Vercel ビルドで実確認） |
| 移行コスト | 20 → 22 の差分のみ | 20 → 24 の 2 メジャー分の差分 |

**選択: 24.x。** サポート期間が 1 年長く Vercel 既定にも揃うため、2027-04 に再度メジャー移行する手間を避ける（ユーザー決定）。Next 14.2 + Node 24 の互換性はローカル（Node 24.22.1）での `npm ci` / lint / typecheck / build / `next start` スモークと Vercel ビルドで確認する。Next.js のメジャー更新が必要と判明した場合は本 change では行わず中断して判断を仰ぐ。

**代替案: 22.x。** 最小差分だが EOL が 2027-04-30 と近く、すぐに次の移行が必要になるため採らない。

### Decision 2: `engines.node` は `"24.x"`（範囲指定ではなくメジャー固定表記）

- Vercel はメジャー単位でしか選べないため、`"24.x"` が意図と挙動を一番素直に表す。
- `">=24"` のような上限なし指定は、Vercel 側で将来の 26 等が選ばれる余地を残し、ローカルとの一致（spec 要件）を崩すので採らない。
- `.nvmrc` は `24`（nvm がその時点の最新 24.x を解決する）。パッチ番号まで固定（例 `24.22.1`）すると次のセキュリティリリース時に再度更新が必要になるため採らない。

### Decision 3: `@types/node` も 24 系に揃える（任意だが推奨）

`^20.16.10` のままでも build は通る見込みだが、型定義と実行系の API 差異による見落としを避けるため `^24` 系に上げる。lockfile が変わるため、その差分はこの change の PR に含める。

### Decision 4: パッチ版の確認はビルドログで行う

Vercel はパッチを自動ロールアウトするため、設定では担保できない。プレビュー／本番それぞれのビルドログ冒頭の Node バージョン表示（または一時的に `node -v` を出力）で `v24.22.1` 以上であることを確認し、PR に記録する。恒久的なランタイム表示エンドポイントは追加しない（`dev-trace-tool` 等の既存境界に手を入れないため）。

## Risks / Trade-offs

- [ネイティブ依存が Node 24 でインストール失敗] → ローカルで Node 24 にて `npm ci` / `npm run build` / seed スクリプト 1 本を実行して確認。失敗時は該当パッケージのパッチ更新で対処。`sharp` / `@napi-rs/canvas` は devDependencies なので本番ランタイムへの影響は build 時に限られる。
- [Vercel が 24.22.1 未満のパッチを使う] → ビルドログで確認。未満なら Vercel 側のロールアウト待ちとして記録し、再デプロイで再確認。
- [`packageManager: pnpm@11.6.0` と npm 運用の食い違い] → 今回は挙動を変えない（`installCommand` は npm 明示）。ただし Node 24 化で corepack 経由の pnpm 解決が走るかどうかはビルドログで確認する。
- [Next 14.2 が Node 24 で動かない] → ローカル検証と Vercel ビルドで確認。Next のメジャー更新が必要なら本 change を中断して判断を仰ぐ。

## Migration Plan

1. フィーチャーブランチで `.nvmrc` / `engines.node` /（任意）`@types/node` を更新し、ローカル Node 24 で lint / typecheck / build を通す。
2. Vercel Project Settings の Node.js Version を `24.x` に変更（`engines.node` が優先されるが表示を揃える）。
3. PR を作成しプレビューデプロイ → ビルドログで Node バージョン確認 → 主要画面のスモーク。
4. `main` にマージ → 本番デプロイ → ビルドログ確認 → 本番 URL でスモーク。

**ロールバック:** Node 20 には戻せない（Vercel が新規デプロイを拒否するため）。問題が出た場合は、Vercel 上で直前の正常な本番デプロイ（Node 20 で build 済みの既存デプロイ）を Promote / Instant Rollback して一時退避し、Node 24 上で修正を続ける。

## Open Questions

- `package.json` の `packageManager: pnpm@11.6.0` と、実際の `package-lock.json` + `npm install` 運用のどちらを正とするか（本 change では触らない。別 change で整理）。
- Vercel Project Settings の現在の Node.js Version 設定値（未確認。タスクで確認）。
- Next.js 15 以降への更新時期（別 change で計画）。
