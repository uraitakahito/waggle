---
title: 開発環境
description: 前提・日々のコマンド・Compose を使わない実行・トラブルシュート。
---

## 前提

- **Node.js 24** (`.nvmrc` のバージョン)。nvm があれば `nvm use`。
- **npm 11+** — Node 24 に同梱。
- **Docker 25+ (BuildKit 有効)** — Compose スタックに必要。ホストだけの開発には不要。
- **`curl`** が PATH にあること — `setup.sh` が使います。
- エンドツーエンドの実行には、`BROWSERHIVE_SERVER` で届く **BrowserHive** と
  `DATABASE_URL` で届く **Postgres**。Compose スタックは両方を立ち上げます。
  固定バージョンは [BrowserHive の更新](/waggle/ja/upgrading-browserhive/)を参照。

## 初回セットアップ

```sh
git clone https://github.com/<you>/waggle.git
cd waggle
nvm use
npm ci
./setup.sh          # .env, Dockerfile.dev, docker-entrypoint.sh, etc/seaweedfs/*
npm run check       # typecheck + lint + format:check + テスト
```

`setup.sh` は `docker compose` を叩く前に必須です。ここでダウンロードされる
ファイルは gitignore されており、実行後にしか存在しません。

## 日々のコマンド

| コマンド                                 | 内容                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------ |
| `npm run dev -- <args>`                  | ビルドしてから CLI を実行 (`tsc` → `node dist/cli.js`)。                 |
| `npm run build`                          | `tsconfig.build.json` で `dist/` に JS/d.ts を出力。                     |
| `npm run typecheck`                      | `tsc --noEmit`。テストと `*.config.ts` も含む。                          |
| `npm run lint` / `lint:fix`              | ESLint flat config (typescript-eslint recommendedTypeChecked)。          |
| `npm run format` / `format:check`        | Prettier。`.prettierignore` が `dist/` と `src/http/generated/` を除外。 |
| `npm test` / `test:watch`                | `test/` 配下の Vitest ユニットテスト。                                   |
| `npm run check`                          | typecheck + lint + format:check + test。push 前に実行。                  |
| `npm run db:migrate` / `db:migrate:down` | `DATABASE_URL` に対する Kysely マイグレーション。                        |
| `npm run db:seed` / `db:seed:down`       | `src/db/seeds/` の seed。                                                |
| `npm run openapi:generate`               | vendored spec から `src/http/generated/` を再生成。                      |
| `npm run openapi:check`                  | 生成して `git diff --exit-code` (CI のドリフト検査)。                    |
| `npm run openapi:sync`                   | 固定タグから spec を取り直す。                                           |
| `npm run site:dev` / `site:build`        | このドキュメントサイト。                                                 |
| `npm run site:check`                     | サイトをビルドし、参照の整合を検証。                                     |

## Compose スタックで作業する

dev の `waggle` サービスは `tail -F /dev/null` で待機する常駐シェルコンテナです。

```sh
docker compose -f compose.dev.yaml up --build -d
docker compose -f compose.dev.yaml exec waggle zsh
```

`.zshrc` が nvm を読み込むので、`node` / `npm` は dev イメージに焼き込まれた
バージョンに解決されます。イメージは `node_modules` を同梱しないため、セッション
ごとに一度インストールし、キャプチャ前にマイグレーションと seed を実行します。

:::caution
リポジトリは `/app` にバインドマウントされているので、コンテナ内の `npm ci` は
**ホストの `node_modules` を Linux バイナリで上書きします**。ホスト側でのちほど
`Cannot find module @rollup/rollup-darwin-arm64` が出たらこれです。ホストで
`rm -rf node_modules && npm ci` すれば直ります。
:::

コンテナの外からワンライナーで叩くときは、rc ファイルに nvm を読ませるため
`zsh -ic` が必要です。

```sh
docker compose -f compose.dev.yaml exec -T waggle \
  zsh -ic 'cd /app && npm run dev -- --webp --limit 1'
```

Chromium ワーカーは **headless** です。描画を見たいときは、ローカルの Chrome で
`chrome://inspect` を開き、_Configure…_ に `localhost:9222` と `localhost:9223`
を登録してターゲットを inspect します。DevTools のスクリーンキャストが、上流の
Chromium リポジトリが退役させた noVNC イメージの代替です。

## 本番イメージのスモークテスト

```sh
./scripts/prod-smoke.sh
```

常駐サービスを detached で起動し、`/v1/status` を BrowserHive が健全になるまで
ポーリングし、`waggle-migrator` → `waggle-seeder` → `waggle` を
`docker compose run --rm` で順に実行し、`EXIT` トラップでスタックを片付け、
waggle の終了コードを自分の終了コードとして返します。

:::note[なぜ `--profile run --exit-code-from waggle` を使わないのか]
`--exit-code-from` は `--abort-on-container-exit` を含意し、Docker Compose
v5.1.2 ではこれが**最初のコンテナ終了**で発火します — `waggle-migrator` の
正当な exit 0 も含めて。その結果スタック全体が停止に入り、約 300 ms 後に
Postgres へ SIGTERM が飛びます。`waggle-seeder` は停止処理中に起動して
`getaddrinfo ENOTFOUND postgres` で即死し、waggle 本体は一度も走りません。
:::

このスクリプトは常駐サービスをビルドしますが、**`waggle:latest` はビルドしません**。
waggle 自身のソースを変えたときは明示的にビルドしないと、古いイメージで
スモークテストしてしまいます。

```sh
docker compose -f compose.prod.yaml build waggle
```

## 外部の Postgres / BrowserHive に対して動かす

```sh
DATABASE_URL=postgres://user:pass@db.host:5432/waggle \
BROWSERHIVE_SERVER=https://browserhive.example/ \
  npm run db:migrate

DATABASE_URL=postgres://user:pass@db.host:5432/waggle \
BROWSERHIVE_SERVER=https://browserhive.example/ \
  npm run dev -- --webp --limit 3
```

独自 CA での TLS には、CLI を叩く前に `NODE_EXTRA_CA_CERTS` に CA ファイルを
指定します。信頼ストアを実際に変えるのはこの環境変数で、`--tls-ca-cert` は
ログに出すためのものです。Postgres の TLS は `DATABASE_URL` にパラメータを
書きます (例: `?sslmode=require`)。

## トラブルシュート

- **`chromium-server` が `starting` のまま** — `curl http://localhost:9222/json/version`
  を叩く。CDP が応答しなければビルドが終わっていないか起動スクリプトが落ちている。
  `docker compose logs chromium-server-1` に supervisord の出力が出る。
- **BrowserHive が起動直後に落ちる** — 起動時の `HeadBucket` は fatal です。
  サービスに `WAIT_FOR_S3` が設定されているか、SeaweedFS が
  `Bucket browserhive ready.` を出しているか確認してください。
- **`Request rejected` のメッセージに `/…` のパスが出る** — それは BrowserHive の
  RFC 7807 の `detail` が問題のフィールドを名指ししています。リクエストはタスクに
  なっていません。
- **ホストのビルドが `@rollup/rollup-darwin-arm64` で落ちる** — 上のバインドマウントの
  注意を参照。

## リポジトリの約束

- ソースは `src/`、テストは `test/`、1 モジュール 1 関心。
- `src/http/generated/` は生成物でコミット対象。手で編集しない。
- Prettier と ESLint が正。push 前に `npm run check`。
- ドキュメントは `docs-site/` に英語と日本語で置く。英語ページだけを追加すると
  `npm run site:check` が落ちます。
