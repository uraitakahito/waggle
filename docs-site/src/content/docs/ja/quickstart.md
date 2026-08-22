---
title: クイックスタート
description: Compose スタックを立ち上げ、urls を seed し、最初のキャプチャを投げるまで。
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
container-compose は `/etc/hosts` を書き換える方式に退行し、このスタックの
非 root コンテナでは無音で失敗します。

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
npm ci                        # 初回のみ
npm run db:migrate            # urls テーブルを作成
npm run db:seed               # サンプル 5 件を投入
```

## 5. キャプチャを投げる

```sh
npm run dev -- --wacz --limit 1
```

受理された URL ごとに 1 行、最後にサマリが出ます。

```json
{"msg":"Request accepted","progress":"1/1","taskId":"e785962b-…","labels":["Apple"]}
{"msg":"Request summary","total":1,"accepted":1,"rejected":0,"durationMs":23}
```

`accepted` は BrowserHive がキューに入れたという意味で、**キャプチャが完了した
という意味ではありません**。

## 6. 結果を見る

waggle にそのためのエンドポイントはありません。キャプチャは非同期で、結果は
BrowserHive のものだからです。上の実行で得た `taskId` で BrowserHive に
問い合わせます。

```sh
grpcurl -plaintext -import-path proto -proto browserhive/v1/capture.proto \
  -d '{"taskId":"<taskId>"}' \
  localhost:50051 browserhive.v1.CaptureService/GetCapture \
  | jq -c '{state, status: .report.status, artifacts: .report.artifacts}'
```

`state` が `CAPTURE_STATE_PENDING` か `_PROCESSING` ならまだ処理中なので、もう
一度問い合わせてください。同じ内容は
`<taskId>_..._<labels>.result.json` としてバケットにも書かれます。結果を
取りこぼしてはいけない用途ではそちらを読みます。
キャプチャ結果を参照。

成果物は同梱の SeaweedFS バケット (`browserhive`) に置かれます。命名規則や WACZ の
中身は
BrowserHive のストレージのページにあります。

## 次に読むもの

- 自分の URL を追加する → [URL ソース](/waggle/ja/url-source/)
- 撮り方を変える → [キャプチャオプション](/waggle/ja/capture-options/)
- Compose を使わずに動かす → [開発環境](/waggle/ja/development-environment/)
