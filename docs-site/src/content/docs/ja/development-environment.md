---
title: 開発環境
description: 前提・日々のコマンド・Compose を使わない実行・トラブルシュート。
---

## 前提

- **Node.js 24** (`.nvmrc` のバージョン)。nvm があれば `nvm use`。
- **pnpm 11** — `packageManager` が固定している版。`corepack enable` で入る。
- **[Apple Container](https://github.com/apple/container)** と **container-compose**
  （どちらも Homebrew）— スタックに必要。ホストだけの開発には不要。macOS 専用です。
- **`curl`** と **`git`** が PATH にあること。
- `DATABASE_URL` で届く **Postgres**。Compose スタックが立ち上げます。
- 実際に取り込むには **BrowserHive** と、それを回す Windmill の flow。waggle は
  もう BrowserHive の在り処を持たず、`WAGGLE_CRAWL_WEBHOOK_URL` へ投げるだけです。
  flow は [forage](https://github.com/uraitakahito/forage) に居ます。スタックが今も
  BrowserHive を build するのは flow が要るからで、固定バージョンは
  [BrowserHive の更新](/waggle/ja/upgrading-browserhive/)を参照。

## 初回セットアップ

```sh
git clone https://github.com/<you>/waggle.git
cd waggle
nvm use
pnpm install
sudo container system dns create waggle   # マシンごとに 1 回
./setup.sh          # submodule 初期化 + .env
pnpm run check       # typecheck + lint + format:check + env + テスト
```

`setup.sh` は `container-compose` を叩く前に必須です。すべての build context が
指す `.upstream/browserhive` submodule を初期化し、`waggle` DNS ドメインが
未登録なら止まります。

### 環境変数

コードが読む環境変数は **35 個**あり、読み取りの仕組みは 3 つに分かれています。
`src/config/` の `required()`/`optional()`、commander の `.env()`（こちらは
`--help` にも出ます）、そして素の `process.env[…]`（これは `scripts/` にもあります）。
必須は 7 個です。

一覧は `.env.example` の 1 か所だけです。`setup.sh` はこれを `.env` に写し、
`WAGGLE_DEV_SUBJECT` を実行者の名前に置き換えます。`.env` を作るものは他にありません
—— 一覧が 2 つあれば必ずずれるからです。OpenFGA の 2 つの ID は
`pnpm run fga:deploy` が出力するまで空のままです
（[アーカイブ台帳](/waggle/ja/archive-ledger/#セットアップ)を参照）。

`scripts/check-env.mjs`（`pnpm run check` に含まれ、CI では独立したステップ）が、
コードの読み取りと `.env.example` の宣言を両方向で突き合わせます。古い雛形は
雛形が無いより悪い —— 信用して使われるので、足りないときに疑う先が残りません。

### 空文字は「値が無い」とは別の状態

`.env` に `FOO=` と書くと `FOO` は空文字になります。行ごと無ければ未設定です。
この 2 つは別の状態で、POSIX はそれぞれに別の記法を与えています ——
`${FOO:-default}` は両方で既定値に落ち、`${FOO-default}` は未設定のときだけです。

この repo は前者に揃えてあります。**空文字は「無い」と同じ意味**です。env は
`optional()`（または `need()`）で読み、`process.env[…] ?? default` は使いません
—— それは後者の意味で、空文字をそのまま値にしてしまいます。

そして「空で設定されている」はほぼ必ず打ち間違いなので、`src/config/env.ts` の
起動時検査は**黙って既定値に戻さず、名前を挙げて止まります**。これには理由があって、
空文字は「無い」より厳密に悪い状態でした —— `DATABASE_URL=` は commander の必須
チェックを通り、API は起動し、`/healthz` は 200 を返し、最初のクエリで
`DATABASE_URL` という語を一度も出さない SASL エラーになっていました。

そのため `.env.example` の行は 2 種類しかありません。

```sh
NAME=value     # 値を渡す
#NAME=value    # 既定値を見せるだけ（使うならコメントを外して値を書く）
```

生の `NAME=` を書けるのは**必須の 7 個だけ**です。必須の空は `collectEnv` が
「不足」として報告します。この規則も `check-env.mjs` が検査しています。

## 日々のコマンド

| コマンド                                  | 内容                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| `pnpm run api`                            | ビルドしてから API を実行 (`tsc` → `node dist/api/server.js`)。         |
| `pnpm run build`                          | `tsconfig.build.json` で `dist/` に JS/d.ts を出力。                    |
| `pnpm run typecheck`                      | `tsc --noEmit`。テストと `*.config.ts` も含む。                         |
| `pnpm run lint` / `lint:fix`              | ESLint flat config (typescript-eslint recommendedTypeChecked)。         |
| `pnpm run format` / `format:check`        | Prettier。`.prettierignore` が `dist/` と `src/rpc/generated/` を除外。 |
| `pnpm test` / `test:watch`                | `test/` 配下の Vitest ユニットテスト。                                  |
| `pnpm run check`                          | typecheck + lint + format:check + test。push 前に実行。                 |
| `pnpm run db:migrate` / `db:migrate:down` | `DATABASE_URL` に対する Kysely マイグレーション。                       |
| `pnpm run db:seed` / `db:seed:down`       | `src/db/seeds/` の seed。                                               |
| `pnpm run proto:generate`                 | vendored の `.proto` から `src/rpc/generated/` を再生成 (buf)。         |
| `pnpm run proto:check`                    | 生成して `git diff --exit-code` (CI のドリフト検査)。                   |
| `pnpm run proto:sync`                     | 固定した submodule から `.proto` を取り直す。                           |
| `pnpm run site:dev` / `site:build`        | このドキュメントサイト。                                                |
| `pnpm run site:check`                     | サイトをビルドし、参照の整合を検証。                                    |

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
```

BrowserHive の在り処はもうここにありません。スタックが公開している唯一の gRPC の
口 `localhost:50051` は、grpcurl と flow のためのもので、waggle のためではありません。

`pnpm run` 系のコマンドはこの `.env` を自分で読みます
（`node --env-file-if-exists=.env`）。シェルで `export` する必要はありません。
**すでに環境にある変数のほうが優先される**ので、一時的に別の DB を向きたいときは
`DATABASE_URL=... pnpm run db:migrate` と前置きすれば効きます。`node dist/...` を
直接叩く場合は読まれないので、そのときは自分で渡してください。

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

スタックを起動し、BrowserHive が `GetStatus` に応答するまでポーリングし、
`waggle:latest` をビルドしてから migrate → seed → API を `container run --rm` で
順に実行し、API に `/healthz` を訊き、`EXIT` トラップでスタックを片付け、
終了コードを自分の終了コードとして返します。

**もう取り込みはしません。** waggle は BrowserHive と gRPC で話さないので、
このスクリプトが示すのは「イメージが起動すること」—— migration が当たり、seed が
入り、API が答えること —— です。取り込みの経路は forage の `pnpm run test:e2e` が
端から端まで見ます（あちらは Windmill も要ります）。

一発ジョブが素の `container run` なのは、container-compose に `run` が無いから
です。これにより、以前の `--profile run --exit-code-from waggle` の回避策も
不要になりました — 回避対象だった Docker Compose の挙動（migrator の正当な
exit 0 でスタック全体が停止する）が、こちらには存在しないためです。

## 外部の Postgres に対して動かす

```sh
DATABASE_URL=postgres://user:pass@db.host:5432/waggle \
  pnpm run db:migrate

DATABASE_URL=postgres://user:pass@db.host:5432/waggle \
WAGGLE_CRAWL_WEBHOOK_URL=https://windmill.example/api/w/…/jobs/run/f/f/crawl \
WAGGLE_CRAWL_WEBHOOK_TOKEN=… \
  pnpm run api
```

Postgres の TLS は `DATABASE_URL` にパラメータを書きます (例: `?sslmode=require`)。

**BrowserHive の TLS はもうここで設定しません。** そのチャンネルを持っているのは
flow なので、CA は Windmill 側の変数 `u/admin/browserhive_tls_ca` に置きます
（空文字なら平文）。

## ローカルで身元を用意する

身元の入口は API の 1 つだけで、**既定では全員を拒みます。**

| 経路                 | 既定 | 開発用ヘッダ            | JWT                  |
| -------------------- | ---- | ----------------------- | -------------------- |
| API (`/api`, picker) | 拒否 | `WAGGLE_DEV_IDENTITY=1` | `WAGGLE_OIDC_ISSUER` |

以前は CLI の行がもう 1 つあり、環境から `WAGGLE_DEV_SUBJECT` と
`WAGGLE_OIDC_TOKEN` を読んでいました。この 2 つは今も `setup.sh` が書き、
`.env.example` にも宣言されていますが、CLI が消えたので実行時に読むものはありません。

**JWT の経路が開発用ヘッダより優先されます。** 両方設定された環境で、
そのポートに届く者が誰にでもなれるほうへ落ちてはいけないためです。

### 開発用の issuer

`WAGGLE_OIDC_ISSUER` を設定すると、API は **本番と同じ検証コード** を通ります
—— 署名、`iss` / `aud` の照合、有効期限、JWKS の取得。本物の IdP が決まるまでは
同梱の issuer を使います。

```bash
pnpm run oidc:issuer                                   # :9099 に立つ
export WAGGLE_OIDC_ISSUER=http://127.0.0.1:9099
export WAGGLE_OIDC_TOKEN=$(pnpm run oidc:token --subject alice --org acme)
```

`--subject` を変えると **「人が投げた場合」と「サービスが投げた場合」の両方を
作れます**。後者は OpenFGA の owner tuple が `user:<サービス名>` になり、
そのアーカイブを人が消せなくなる状態です —— 認証を入れるより前に、認可の設計を
ここで踏めます。

:::caution[開発用です]
`POST /token` は誰にでもトークンを刷ります。起動時に警告を出すのはそのためです。
鍵は issuer のプロセスの中だけに在り、**起動のたびに作り直されます** ——
再起動すると前のトークンは通らなくなります。それが鍵の更新の再現になります。
:::

### 本物の IdP へ移るとき

変わるのは `WAGGLE_OIDC_ISSUER` と `WAGGLE_OIDC_AUDIENCE` の値だけです。
`jwtIdentityResolver` は 1 行も変わりません。

ただし **JWKS を HTTP で取ってくる経路は単体試験では守れません**。
`createRemoteJWKSet` をローカルの鍵に差し替えても試験は緑のままなので、
この節の手順を実際に通すことがその代わりになります。

組織のクレームの綴りは IdP ごとに違います (`groups` / `roles` / 独自)。
差し替えるのは `src/config/identity.ts` の `ORGANIZATIONS_CLAIM` 1 か所だけです ——
API は `identityFromClaims` を通してそこを読みます。

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
- **`/api/crawls` が誰に対しても 404 を返す** — 呼び出し元に `can_submit` が
  無いか、`WAGGLE_CRAWL_WEBHOOK_URL` が未設定で route がそもそも登録されて
  いないかのどちらかです。どちらかは起動時のログが言います
  （`… is not set — /api/crawls is not served`）。
- **docs のビルドが BrowserHive のピンを読めない** —
  `git submodule update --init --recursive` を実行。

### 自分の持ち物をクロールする

スタックには取り込み対象のフィクスチャ [meadow](https://github.com/uraitakahito/meadow) が
profile 付きで入っている。見知らぬサイトに向けずにクロールを試せる:

```sh
container-compose --profile meadow up -d -b
```

port は publish していない。`meadow.waggle:8080` はコンテナからも host からも引ける。
種にするのは `/links/hub` —— `/links/*` はどれもそのページを 1 か所だけ変えたもので、
それが「誤った規則を適用しているクローラ」と「単に壊れているクローラ」を分ける。

meadow はリクエストログも持っていて、**それを使うことがこのフィクスチャの要点**:

```sh
curl -s http://meadow.waggle:8080/__request-counts
```

`crawl_pages` が言うのは waggle が**記録した**こと、ログが言うのはフィクスチャが
**実際に要求された**こと。「robots を尊重した」は後者でしか決着しない —— 台帳に無い
ページは、取りに行かなかったのか、取りに行って捨てたのか、台帳からは区別できない。

meadow は `.upstream/browserhive` 経由ではなく `.upstream/meadow` に**直接** vendor して
いる。あちらが抱える meadow はずっと古く、2 つの pin は別々の都合で動くので、
どちらももう一方を待つ理由が無い。

## リポジトリの約束

- ソースは `src/`、テストは `test/`、1 モジュール 1 関心。
- `src/rpc/generated/` は生成物でコミット対象。手で編集しない。
- Prettier と ESLint が正。push 前に `pnpm run check`。
- ドキュメントは `docs-site/` に英語と日本語で置く。英語ページだけを追加すると
  `pnpm run site:check` が落ちます。
