---
title: キャプチャオプション
description: waggle のフラグが BrowserHive のどのリクエストフィールドに対応するか。
---

waggle 自身は何もキャプチャしないので、このページは**対応表**であって説明では
ありません。各フラグは `POST /v1/captures` のボディのフィールドを 1 つ設定する
だけで、そのフィールドが何をするかは BrowserHive が定義するものです。挙動が
変わったときに正しいままでいられるのは、向こうのドキュメントだけです。

フラグは URL 単位ではなく**実行単位**です。コマンドラインで一度意図を宣言すると、
その実行の全行に適用されます。

## フォーマット

最低 1 つが true でないと BrowserHive がリクエストを拒否します。

| フラグ    | `captureFormats` のキー |
| --------- | ----------------------- |
| `--png`   | `png`                   |
| `--webp`  | `webp`                  |
| `--html`  | `html`                  |
| `--links` | `links`                 |
| `--mhtml` | `mhtml`                 |
| `--wacz`  | `wacz`                  |

## キャプチャの挙動

| フラグ                                    | `CaptureRequest` のフィールド | 意味                                                                                          |
| ----------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------- |
| `--device-scale-factor <n>`               | `deviceScaleFactor`           | BrowserHive: Behaviors            |
| `--archive-mode <single-pass\|multipass>` | `archiveMode`                 | BrowserHive: Behaviors            |
| `--operation-delay-ms <ms>`               | `operationDelayMs`            | BrowserHive: 環境変数 |
| `--behaviors <ids>`                       | `behaviors.builtins`          | BrowserHive: Behaviors            |
| `--no-site-behaviors`                     | `behaviors.siteBehaviors`     | BrowserHive: Behaviors            |
| `--dismiss-banners`                       | `dismissBanners`              | BrowserHive: Behaviors            |
| `--accept-language <bcp47>`               | `acceptLanguage`              | BrowserHive: クイックスタート    |

## 指定しなければ「サーバ既定」

渡さなかったフラグは、**リクエストボディからキーごと省かれます** — `null` として
送るのではありません。これらのフィールドはすべて BrowserHive 側に既定値があるので、
省略は「そのサーバの設定に従う」を意味し、waggle が現在の既定値を把握しておく
必要がなくなります。

```ts file="src/config/cli-options.ts#capture-settings"

```

## 実行設定

こちらは実行単位の意図ではなくデプロイ設定なので、環境変数からも読みます。

| フラグ                 | 環境変数                  | 用途                                                                                              |
| ---------------------- | ------------------------- | ------------------------------------------------------------------------------------------------- |
| `--database-url <url>` | `DATABASE_URL`            | `urls` テーブルの場所。必須。                                                                     |
| `--server <url>`       | `BROWSERHIVE_SERVER`      | BrowserHive のベース URL。省略時は生成 SDK に焼き込まれた値 (vendored spec の `servers[0].url`)。 |
| `--tls-ca-cert <path>` | `BROWSERHIVE_TLS_CA_CERT` | ログに出すためのもの。Node の信頼ストアを設定するのは `NODE_EXTRA_CA_CERTS` で、そちらが本体。    |
| `--limit <n>`          | —                         | 先頭 n 件だけ読む。動作確認用。                                                                   |

## 例

```sh
# Retina 忠実・完全アーカイブ・chrome://inspect で観察できる速度
npm run dev -- --wacz --limit 1 --archive-mode multipass --operation-delay-ms 250

# behavior を一切走らせない — "" は「省略」とは違う
npm run dev -- --png --limit 1 --behaviors "" --no-site-behaviors
```

拒否されたリクエストは、BrowserHive の problem レスポンスから理由をそのまま
報告します。

```json
{ "msg": "Request rejected", "error": "/captureFormats must be object" }
```
