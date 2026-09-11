---
title: キャプチャオプション
description: この配備が「何を撮るか」をどう決めるか。形式と署名は環境変数から決まる。
---

capture-ledger 自身は何も撮りませんし、CLI が消えた今は BrowserHive とも話しません
（投げるのは Windmill の flow です）。ここに残っているのは **1 つの判断** ——
どの形式を要求するか、署名を必須にするか —— だけで、capture-ledger はそれを環境変数から
決め、投げるたびに載せます。

線の引き方はクロールの API と同じです。**呼ぶ側が「いつ」を決め、capture-ledger が
「何を」決める。** 形式はリクエストの性質ではなく配備の性質なので、呼び出し元から
受け取らないようにしてあります。

## フォーマット

`CAPTURE_LEDGER_CAPTURE_FORMATS` にカンマ区切りで書きます。既定は `wacz` ——
このパイプラインが作るのは再生できるアーカイブで、他の形式はその付随物だからです。

```sh
CAPTURE_LEDGER_CAPTURE_FORMATS=wacz   # png, webp, html, links, mhtml, wacz
CAPTURE_LEDGER_CAPTURE_SIGNING=1      # wacz-auth 署名を要求する。wacz が要る
```

| 値      | `captureFormats` のキー |
| ------- | ----------------------- |
| `png`   | `png`                   |
| `webp`  | `webp`                  |
| `html`  | `html`                  |
| `links` | `links`                 |
| `mhtml` | `mhtml`                 |
| `wacz`  | `wacz`                  |

6 つのキーは毎回**全部を明示して**送ります —— BrowserHive にとって「未設定」と
`false` は別物です。最低 1 つが true でないとサーバがリクエストを拒みます。

## 読むのは起動時の 1 回だけ

`CAPTURE_LEDGER_CAPTURE_FORMATS` はクロールのたびではなく、API の起動時に解釈します。
綴りを間違えていれば、その値を名指しでサーバが落ちます。毎回解釈する形にすると、
`waxz` のような打ち間違いは夜中の定期クロールが「形式が 1 つも有効でない」で
失敗して初めて表に出ます —— 原因の設定名を一言も含まないメッセージで。

## リンクを辿るクロールには `links` が足される

`maxDepth` が 1 以上のクロールには、環境変数が何であれ `links: true` が付きます。
無いと 1 段目で必ず止まり、しかも「そのページにリンクが 1 本も無かった」ように
見えます —— 設定の誤りが、サイトの事実と区別できなくなります。

深さ 0 のクロールには足しません。辿らないリンクを取り出させても、相手と bucket に
無駄が出るだけです。

## 署名は落ちず、取り込みが落ちる

`CAPTURE_LEDGER_CAPTURE_SIGNING=1` は形式に `wacz` があることを要求します。サーバに後から
`INVALID_ARGUMENT` を言わせるのではなく、capture-ledger が起動時に拒みます。

**署名が得られなければ、その取り込みは失敗します。** BrowserHive は zip を書く前に
落とすので、署名済みのはずのものが未署名で出ることはありません。これは意図した
挙動ですが、運用上の帰結を明記しておきます —— 署名サービスの設定されていない配備で
署名を有効にすると、**全件**が失敗します。

無効のままにすれば、判断はサーバの `--signing-policy` に委ねられます。`required` で
動いている配備なら、capture-ledger が何も言わなくても署名されます。

結果は台帳に残ります。`archives.signed` は署名が付けば `true`、そもそも求めて
いなければ `null` —— 「このクロールは証拠として使える形のアーカイブを作ったか」に、
zip を 1 つも開かずに答えられます。

## capture-ledger が決めなくなったもの

以前の CLI は `SubmitCapture` のフィールドそれぞれに旗を対応させていました
（`--device-pixel-ratios` / `--operation-delay-ms` / `--behaviors` /
`--no-site-behaviors` / `--dismiss-banners` / `--accept-language` / `--session`）。
**これらはもう存在しません。** capture-ledger が送るのは `captureFormats` と `signing` だけで、
ページの描き方については何も送りません —— 送らないものはすべて、その BrowserHive
サーバの設定どおりになります（意味は BrowserHive 自身のドキュメントが定義します）。

描き方を変えるのは、いまや BrowserHive 側か flow 側の変更であって、capture-ledger の変更では
ありません。

## 呼び出し元がクロールごとに渡せるもの

相手への当たり方と範囲を、`POST /api/crawls` のボディで渡せます
（[アーカイブ台帳](/capture-ledger/ja/archive-ledger/#リンクを辿る)を参照）。

| フィールド        | 既定                         | 意味                                 |
| ----------------- | ---------------------------- | ------------------------------------ |
| `scope`           | `same-origin`                | `same-host` にするとホスト単位に緩む |
| `maxDepth`        | 2。`fromTargets` のときは 0  | どこまで辿るか                       |
| `maxPages`        | 30。ただし種の数は下回らない | 総ページ数                           |
| `perHostDelayMs`  | 2000                         | 同じホストのページ間の間隔           |
| `hostParallelism` | 4                            | 同時に触るホストの数                 |

知らないキーは黙って落とさず **400** で返します。
