---
title: 開発環境
description: 前提・日々のコマンド・Compose を使わない実行・トラブルシュート。
---

## 前提

- **Node.js 24** (`.nvmrc` のバージョン)。nvm があれば `nvm use`。
- **npm 11+** — Node 24 に同梱。
- **[Apple Container](https://github.com/apple/container)** と **container-compose**
  （どちらも Homebrew）— スタックに必要。ホストだけの開発には不要。macOS 専用です。
- **`curl`** と **`git`** が PATH にあること。
- エンドツーエンドの実行には、`BROWSERHIVE_SERVER` で届く **BrowserHive** と
  `DATABASE_URL` で届く **Postgres**。Compose スタックは両方を立ち上げます。
  固定バージョンは [BrowserHive の更新](/waggle/ja/upgrading-browserhive/)を参照。

## 初回セットアップ

```sh
git clone https://github.com/<you>/waggle.git
cd waggle
nvm use
npm ci
sudo container system dns create waggle   # マシンごとに 1 回
./setup.sh          # submodule 初期化 + .env
npm run check       # typecheck + lint + format:check + テスト
```

`setup.sh` は `container-compose` を叩く前に必須です。すべての build context が
指す `.upstream/browserhive` submodule を初期化し、`waggle` DNS ドメインが
未登録なら止まります。

## 日々のコマンド

| コマンド                                 | 内容                                                                    |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| `npm run dev -- <args>`                  | ビルドしてから CLI を実行 (`tsc` → `node dist/cli.js`)。                |
| `npm run build`                          | `tsconfig.build.json` で `dist/` に JS/d.ts を出力。                    |
| `npm run typecheck`                      | `tsc --noEmit`。テストと `*.config.ts` も含む。                         |
| `npm run lint` / `lint:fix`              | ESLint flat config (typescript-eslint recommendedTypeChecked)。         |
| `npm run format` / `format:check`        | Prettier。`.prettierignore` が `dist/` と `src/rpc/generated/` を除外。 |
| `npm test` / `test:watch`                | `test/` 配下の Vitest ユニットテスト。                                  |
| `npm run check`                          | typecheck + lint + format:check + test。push 前に実行。                 |
| `npm run db:migrate` / `db:migrate:down` | `DATABASE_URL` に対する Kysely マイグレーション。                       |
| `npm run db:seed` / `db:seed:down`       | `src/db/seeds/` の seed。                                               |
| `npm run proto:generate`                 | vendored の `.proto` から `src/rpc/generated/` を再生成 (buf)。         |
| `npm run proto:check`                    | 生成して `git diff --exit-code` (CI のドリフト検査)。                   |
| `npm run proto:sync`                     | 固定した submodule から `.proto` を取り直す。                           |
| `npm run site:dev` / `site:build`        | このドキュメントサイト。                                                |
| `npm run site:check`                     | サイトをビルドし、参照の整合を検証。                                    |

## スタックで作業する

```sh
container-compose up -d -b
# grpcurl は vendored の契約を読む。準備完了の判定は GetStatus。
until grpcurl -plaintext -import-path proto -proto browserhive/v1/capture.proto \
  localhost:50051 browserhive.v1.CaptureService/GetStatus >/dev/null 2>&1; do sleep 1; done
```

**dev コンテナはありません。** container-compose のサブコマンドは
`up` / `down` / `build` / `version` の 4 つだけで、入り込むための `exec` が
そもそもありません。必要もありません — platform DNS は `<service>.waggle` を
コンテナ間からもホストからも解決するので、waggle はホストで動かしたまま
コンテナ側のスタックに繋がります。接続文字列は `setup.sh` が `.env` に書きます。

```sh
DATABASE_URL=postgres://waggle:waggle@postgres.waggle:5432/waggle
BROWSERHIVE_SERVER=browserhive.waggle:50051
```

Postgres は `127.0.0.1:5432` にも公開しているので `localhost` でも繋がります。

Docker Compose から来た場合、日常のコマンドはこう対応します。

| Docker Compose                    | Apple Container                      |
| --------------------------------- | ------------------------------------ |
| `docker compose up -d --build`    | `container-compose up -d -b`         |
| `docker compose down`             | `container-compose down`             |
| `docker compose ps`               | `container ls`                       |
| `docker compose logs browserhive` | `container logs browserhive.waggle`  |
| `docker compose exec <svc> sh`    | `container exec -it <svc>.waggle sh` |
| `docker compose run --rm <svc> …` | `container run --rm <image> …`       |

Chromium ワーカーは **headless** です。描画を見たいときは、ローカルの Chrome で
`chrome://inspect` を開き、_Configure…_ に `localhost:9222` と `localhost:9223`
を登録してターゲットを inspect します。

## 本番イメージのスモークテスト

```sh
./scripts/prod-smoke.sh
```

スタックを起動し、`/v1/status` が応答するまでポーリングし、`waggle:latest` を
ビルドしてから migrate → seed → キャプチャ 1 本を `container run --rm` で
順に実行し、`EXIT` トラップでスタックを片付け、waggle の終了コードを自分の
終了コードとして返します。

一発ジョブが素の `container run` なのは、container-compose に `run` が無いから
です。これにより、以前の `--profile run --exit-code-from waggle` の回避策も
不要になりました — 回避対象だった Docker Compose の挙動（migrator の正当な
exit 0 でスタック全体が停止する）が、こちらには存在しないためです。

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

- **コンテナが上がらない** — `container ls` で起動状況、
  `container logs <svc>.waggle` で理由を見る。Chromium なら
  `curl http://localhost:9222/json/version` で CDP の応答を確認。
- **名前が解決しない** — `container system dns ls` に `waggle` があるか、
  `docker-compose.yml` のどのサービスにも `container_name:` が無いか
  （付けると DNS 命名が抑止される）を確認。
- **BrowserHive が起動直後に落ちる** — 起動時の `HeadBucket` は fatal です。
  サービスに `WAIT_FOR_S3` が設定されているか、SeaweedFS が
  `Bucket browserhive ready.` を出しているか確認してください。
- **`Request rejected` のメッセージに `/…` のパスが出る** — それは BrowserHive の
  RFC 7807 の `detail` が問題のフィールドを名指ししています。リクエストはタスクに
  なっていません。
- **docs のビルドが BrowserHive のピンを読めない** —
  `git submodule update --init --recursive` を実行。

## リポジトリの約束

- ソースは `src/`、テストは `test/`、1 モジュール 1 関心。
- `src/rpc/generated/` は生成物でコミット対象。手で編集しない。
- Prettier と ESLint が正。push 前に `npm run check`。
- ドキュメントは `docs-site/` に英語と日本語で置く。英語ページだけを追加すると
  `npm run site:check` が落ちます。
