---
title: キャプチャオプション
description: waggle のフラグが BrowserHive のどのリクエストフィールドに対応するか。
---

waggle 自身は何もキャプチャしないので、このページは**対応表**であって説明では
ありません。各フラグは `SubmitCapture` のリクエストのフィールドを 1 つ設定する
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

| フラグ                         | `CaptureRequest` のフィールド | 意味                          |
| ------------------------------ | ----------------------------- | ----------------------------- |
| `--device-pixel-ratios <list>` | `devicePixelRatios`           | BrowserHive: Behaviors        |
| `--operation-delay-ms <ms>`    | `operationDelayMs`            | BrowserHive: 環境変数         |
| `--behaviors <ids>`            | `behaviors.builtins`          | BrowserHive: Behaviors        |
| `--no-site-behaviors`          | `behaviors.siteBehaviors`     | BrowserHive: Behaviors        |
| `--dismiss-banners`            | `dismissBanners`              | BrowserHive: Behaviors        |
| `--accept-language <bcp47>`    | `acceptLanguage`              | BrowserHive: クイックスタート |
| `--session <mode>`             | `session`                     | BrowserHive: セッション       |
| `--signing`                    | `signing`                     | BrowserHive: WACZ への署名    |

## `--signing` は署名を落とさず、取り込みを落とす

署名は WACZ に付くものなので、`--signing` は `--wacz` を要求します。サーバに
`INVALID_ARGUMENT` を言わせる前に、waggle 側で拒みます。

**署名が得られなければ、その取り込みは失敗します。** BrowserHive は zip を書く
前に落とすので、署名済みのはずのものが未署名で出ることはありません。これは意図した
挙動ですが、運用上の帰結を明記しておきます —— 署名サービスの設定されていない配備で
`--signing` を渡すと、その実行の**全件**が失敗します。

フラグを省けば、判断はサーバの `--signing-policy` に委ねられます。`required` で
動いている配備なら、waggle が何も言わなくても署名されます。

結果は台帳に残ります。`archives.signed` は署名が付けば `true`、そもそも求めて
いなければ `null` —— 「この実行は証拠として使える形のアーカイブを作ったか」に、
zip を 1 つも開かずに答えられます。

## 指定しなければ「サーバ既定」

渡さなかったフラグは、**リクエストボディからキーごと省かれます** — `null` として
送るのではありません。これらのフィールドはすべて BrowserHive 側に既定値があるので、
省略は「そのサーバの設定に従う」を意味し、waggle が現在の既定値を把握しておく
必要がなくなります。

```ts file="src/config/cli-options.ts#capture-settings"

```

## 実行設定

こちらは実行単位の意図ではなくデプロイ設定なので、環境変数からも読みます。

| フラグ                      | 環境変数                  | 用途                                                                                           |
| --------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------- |
| `--database-url <url>`      | `DATABASE_URL`            | `capture_targets` テーブルの場所。必須。                                                       |
| `--server <url>`            | `BROWSERHIVE_SERVER`      | BrowserHive のベース URL。省略時は `src/rpc/client.ts` の `DEFAULT_TARGET`。                   |
| `--tls-ca-cert <path>`      | `BROWSERHIVE_TLS_CA_CERT` | ログに出すためのもの。Node の信頼ストアを設定するのは `NODE_EXTRA_CA_CERTS` で、そちらが本体。 |
| `--limit <n>`               | —                         | 先頭 n 件だけ読む。動作確認用。                                                                |
| `--no-collect`              | —                         | 投げて終わり、結果は後から `fga:reconcile` が bucket の manifest から拾う。                    |
| `--capture-timeout-ms <ms>` | —                         | 1 件の待ち時間の上限。サーバが申告する予算を上書きする。                                       |

## 例

```sh
# 1x と 2x で 2 回読み込み、chrome://inspect で観察できる速度で。
# 順序に意味がある: PNG / WebP は最後の倍率で出るので、これだと 2x になる。
pnpm run capture --wacz --limit 1 --device-pixel-ratios 1,2 --operation-delay-ms 250

# behavior を一切走らせない — "" は「省略」とは違う
pnpm run capture --png --limit 1 --behaviors "" --no-site-behaviors
```

拒否されたリクエストは、BrowserHive の problem レスポンスから理由をそのまま
報告します。

```json
{ "msg": "Request rejected", "error": "/captureFormats must be object" }
```
