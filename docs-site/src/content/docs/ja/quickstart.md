---
title: クイックスタート
description: Compose スタックを立ち上げ、urls を seed し、最初のキャプチャを投げるまで。
---

Compose スタックは waggle に必要なものを一式立ち上げます — Postgres、SeaweedFS、
headless の Chromium ワーカー 2 台、そして[固定タグ](/waggle/ja/upgrading-browserhive/)から
ビルドされる BrowserHive です。

## 1. ローカルファイルを生成する

```sh
./setup.sh
```

`setup.sh` は `.env` を書き出し、意図的にコミットしていない 3 種類のファイルを
ダウンロードします: `hello-javascript` テンプレートからの `Dockerfile.dev` と
`docker-entrypoint.sh`、そして固定タグの BrowserHive からの `etc/seaweedfs/*` です。
`docker compose` を叩く前に必ず実行してください。

## 2. スタックを起動する

```sh
docker compose -f compose.dev.yaml up --build -d
```

初回は BrowserHive と Chromium イメージをソースからビルドするため、数分かかります。
状態を確認します (まだ起動していなければ curl がそのまま失敗を報告します):

```sh
curl -sS --fail-with-body http://localhost:8080/v1/status | jq '{isRunning, workers: [.workers[].health]}'
# → { "isRunning": true, "workers": ["ready", "ready"] }
```

ワーカーは headless です。描画を見たい場合は、ローカルの Chrome で
`chrome://inspect` を開き、_Configure…_ に `localhost:9222` と `localhost:9223`
を登録してください。

## 3. データベースを準備する

waggle コンテナは常駐シェルで、使うまで何もしません。`node_modules` は
イメージに焼き込まれていないので、最初に一度だけインストールします。

```sh
docker compose -f compose.dev.yaml exec waggle zsh
# コンテナの中で:
npm ci                        # 初回のみ
npm run db:migrate            # urls テーブルを作成
npm run db:seed               # サンプル 5 件を投入
```

:::caution
リポジトリは `/app` にバインドマウントされているため、**コンテナ内の `npm ci` は
ホストの `node_modules` を Linux バイナリで上書きします**。コンテナの外で作業する
前に、ホスト側でもう一度 `npm ci` してください。
:::

## 4. キャプチャを投げる

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

## 5. 結果を見る

waggle にそのためのエンドポイントはありません。キャプチャは非同期で、結果は
BrowserHive のものだからです。完了ログを読みます。

```sh
docker compose -f compose.dev.yaml logs browserhive \
  | grep '"Task completed"' | tail -1 | jq -c '{waczLocation, completeness}'
```

成果物は同梱の SeaweedFS バケット (`browserhive`) に置かれます。命名規則や WACZ の
中身は
[BrowserHive のストレージのページ](https://uraitakahito.github.io/browserhive/ja/storage/)にあります。

## 次に読むもの

- 自分の URL を追加する → [URL ソース](/waggle/ja/url-source/)
- 撮り方を変える → [キャプチャオプション](/waggle/ja/capture-options/)
- Compose を使わずに動かす → [開発環境](/waggle/ja/development-environment/)
