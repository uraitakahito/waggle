---
title: クイックスタート
description: Compose スタックを立ち上げ、capture_targets を seed し、最初のキャプチャを投げるまで。
---

スタックは waggle に必要なものを一式立ち上げます — Postgres、SeaweedFS、
headless の Chromium ワーカー 2 台、そして[固定した submodule](/waggle/ja/upgrading-browserhive/)から
ビルドされる BrowserHive です。実行基盤は
[Apple Container](https://github.com/apple/container)で、`container-compose` が駆動します。

## 1. DNS ドメインを登録する（マシンごとに 1 回）

```sh
sudo container system dns create waggle
```

プロジェクト名がそのまま DNS ドメインになります。コンテナは `<service>.waggle`
という名前になり、**コンテナ間からもホストからも**解決できます — waggle 自身を
ホストで動かしてこのスタックに繋げられるのはこのためです。登録が無いと
container-compose は `container exec` で **各コンテナの中の** `/etc/hosts` に
追記する方式に退行します（お使いの Mac の `/etc/hosts` は触りません）。その
書き込みはこのスタックの非 root コンテナでは失敗しますが、container-compose は
終了状態を見ず何も出力しないため、**一部のサービスだけ名前が引けない**という
追いにくい症状になります。

## 2. ローカルファイルを生成する

```sh
./setup.sh
```

ツールチェーンを確認し、`.upstream/browserhive` submodule を初期化し（上流の
ソースはすべてここから来ます）、`.env` を書き出します。`container-compose` を
叩く前に必ず実行してください。

## 3. スタックを起動する

```sh
container-compose up -d -b
```

初回は BrowserHive と Chromium イメージをソースからビルドするため、数分かかります。
状態を確認します (まだ起動していなければ grpcurl がそのまま失敗を報告します):

```sh
grpcurl -plaintext -import-path proto -proto browserhive/v1/capture.proto \
  localhost:50051 browserhive.v1.CaptureService/GetStatus \
  | jq '{isRunning, workers: [.workers[].health]}'
# → { "isRunning": true, "workers": ["WORKER_HEALTH_READY", "WORKER_HEALTH_READY"] }
```

`-import-path proto -proto …` は、この repo に vendor した契約を grpcurl に
指しています。BrowserHive は reflection を提供しません —— 未実装ではなく意図的な
判断で、有効にするには descriptor set を同梱して実行時に読ませることになり、
`.proto` がランタイムの資産になってしまうためです。したがって呼ぶ側がサービスを
知る手段がこの `.proto` です —— クライアントの生成元と同じファイルです。

ワーカーは headless です。描画を見たい場合は、ローカルの Chrome で
`chrome://inspect` を開き、_Configure…_ に `localhost:9222` と `localhost:9223`
を登録してください。

## 4. データベースを準備する

**dev コンテナはありません。** waggle はホストで動き、名前でスタックに届きます
（接続文字列は `.env` に入っています）。

```sh
pnpm install         # 初回のみ
pnpm run db:migrate  # capture_targets テーブルを作成
pnpm run db:seed     # サンプル 5 件を投入
```

## 5. 認可を準備する

アーカイブ API と picker は OpenFGA を通します。**store と model の ID は
デプロイして初めて決まる**ので、compose には書けません。手で叩いて `.env` に
貼ります。

```sh
pnpm run fga:migrate  # OpenFGA の datastore を作る
pnpm run fga:deploy   # model を送り、store id と model id を印字する
```

印字された 2 行を `.env` の `WAGGLE_FGA_STORE_ID` と `WAGGLE_FGA_MODEL_ID` に
書き写してください。

:::note[取り込みを投げるだけなら飛ばせます]
この段が要るのは §7 の API と picker です。`pnpm run capture` は OpenFGA を
通りません。
:::

## 6. キャプチャを投げる

```sh
pnpm run capture --wacz --limit 1
```

受理された URL ごとに 1 行、最後にサマリが出ます。

```json
{"msg":"Request accepted","progress":"1/1","taskId":"e785962b-…","labels":["Apple"]}
{"msg":"Request summary","total":1,"accepted":1,"rejected":0,"durationMs":23}
```

`accepted` は BrowserHive がキューに入れたという意味で、**キャプチャが完了した
という意味ではありません**。

## 7. 結果を見る

一覧と picker は `waggle-api` が出します。**host 側で動かします** —— スタックに
そのサービスはありません（§5 と同じ理由で、OpenFGA の ID が起動後にしか
決まらないため）。

```sh
pnpm run api
open http://127.0.0.1:7070/
```

行をクリックすると [replay](https://github.com/uraitakahito/replay) で開きます。
一覧は台帳（`archives` テーブル）から来ていて、**OpenFGA の `can_view` で
絞ってあります**。API を直に叩くこともできます。

```sh
curl -s -H "X-Waggle-Subject: $(whoami)" -H "X-Waggle-Organizations: acme" \
  http://127.0.0.1:7070/api/archives | jq '.archives[0]'
```

一覧が空なら `.env` の `WAGGLE_DEV_IDENTITY=1` を確かめてください。無いと
resolver が誰も通さず、picker は `401` で空のままになります。詳しくは
[アーカイブ台帳](/waggle/ja/archive-ledger/)。

### まだ終わっていないとき

**台帳に載るのは取り込みが終わった後**です。picker に出てこないなら、まだ
撮っている最中か、失敗しています。**進行中の状態は BrowserHive にしか
ありません** —— そちらが正本で、waggle が持っているのは終わった事実の写しです。

```sh
grpcurl -plaintext -import-path proto -proto browserhive/v1/capture.proto \
  -d '{"taskId":"<taskId>"}' \
  localhost:50051 browserhive.v1.CaptureService/GetCapture \
  | jq -c '{state, status: .report.status, artifacts: .report.artifacts}'
```

`state` が `CAPTURE_STATE_PENDING` か `_PROCESSING` ならまだ処理中です。

成果物は同梱の SeaweedFS バケット (`browserhive`) に置かれます。命名規則や
WACZ の中身は BrowserHive のストレージのページにあります。

## 次に読むもの

- アーカイブを配る・共有する → [アーカイブ台帳](/waggle/ja/archive-ledger/)
- 自分の URL を追加する → [URL ソース](/waggle/ja/url-source/)
- 撮り方を変える → [キャプチャオプション](/waggle/ja/capture-options/)
- Compose を使わずに動かす → [開発環境](/waggle/ja/development-environment/)
