---
title: アーカイブ台帳
description: どの WACZ が存在し誰が読んでよいかを waggle がどう記録し、バケットの資格情報を渡さずに署名付き URL を発行するか
---

waggle は BrowserHive が作った WACZ の**台帳**を持ち、読んでよい相手にだけ
短命な署名付き URL を発行します。

構成要素:

|              | 持つもの                             | 場所               |
| ------------ | ------------------------------------ | ------------------ |
| `archives`   | どこに何があるか — bucket・key・由来 | waggle の Postgres |
| OpenFGA      | 誰が何を読んでよいか（関係として）   | 専用の Postgres    |
| `fga_outbox` | OpenFGA へ届ける前のタプル           | waggle の Postgres |

`archives` に所有者の列は意図的にありません。誰が読んでよいかは関係であり、
同じ問いへの答えを 2 か所に持てば、いずれ食い違います。

## なぜ Outbox が要るのか

アーカイブ行の挿入とタプルの書き込みは Postgres と OpenFGA の HTTP API という
別々のシステムに触れ、**両方をまたぐトランザクションは存在しません**。
別々に行えば片方だけ成功しえて、どちらの結果も悪いものです ―
誰も辿り着けないアーカイブか、ロールバックされた行を指す権限か。

そこでタプルの書き込みは、**アーカイブ行と同じトランザクションの中で**
Outbox 行として記録します。両方入るか、どちらも入らないかです。
あとはワーカーが OpenFGA に受理されるまで再送します。

配送は at-least-once で、すでにあるタプルは配送済みとして扱います。

:::caution[OpenFGA の write はバッチ全体がトランザクショナル]
バッチ内に 1 つでも既存のタプルがあると**リクエスト全体が拒否され、新しい
タプルも含めて何も書かれません**。したがってバッチの失敗を単純に
「配送済み」と読むことはできません ― その場合ワーカーはタプルを 1 件ずつ
送り直します。そうしないと新しいタプルが黙って失われます。
:::

## 台帳を埋める 3 つの経路

**ポーリング** ― `waggle` は投げた capture の完了を待ち
（`GetCapture`、完了するまで `PENDING` / `PROCESSING`）、成果物ができたものを
登録します。速いですが、waggle が動いている間しか効きません。
`--no-collect` で省略できます。

**Reconcile** ― `waggle-ledger reconcile` は BrowserHive が各 capture の
成果物の隣に書く `.result.json` マニフェストを走査し、台帳に無いものを
登録します。**これが台帳を自己修復させます**: waggle が何時間止まっていても、
結果が BrowserHive のキャッシュから溢れていても、次の reconcile で拾えます。

**クロール** ― リンクを辿るクロールは、段を報告した時点で自分が取り込んだぶんを
登録します（`src/crawl/register-level.ts`）。段の報告には成果物の在り処が
載っていないので、`.result.json` を読み直してから登録します。

:::note[以前はここが抜けていました]
クロールの経路は `crawl_pages` と `capture_submissions` にしか書いておらず、
**台帳には 1 行も入っていませんでした**。クロールしたページは reconcile を
走らせるまで存在せず、picker にも検索にも出ませんでした。取り込んだ本人が
台帳を書けるのに、掃除役の巡回を待っていたことになります。
:::

ポーリングは遅延のため、reconcile は正しさのためです。
**誰も気づかない穴のある台帳は、台帳が無いより悪い**
― 穴はずっと後で「なぜこのアーカイブが見えないのか」として現れます。

```sh
waggle-ledger reconcile   # バケットから抜けを埋める
waggle-ledger drain       # 溜まったタプルを配送（API も定期的に行う）
```

台帳に入るのは成功した capture だけです。失敗したものは何もアップロード
していないので、記録すると存在しないオブジェクトへの URL を発行できて
しまいます ― 認可は完璧に効いているのに 404、という一番わかりにくい壊れ方です。

### 帰属

マニフェストに組織の情報はありません。BrowserHive にその概念が無いからです。
そこで `waggle` は投げた時点で `capture_submissions` 行（task id → 組織）を
書き、reconciler がそれを読み戻します。`correlationId` に組織 ID を
埋め込む案は採りませんでした ― **約束だけで保たれる規約は、最初に手で
capture を投げた人が破ります**。

## URL を発行する

`waggle-api` は 2 つのエンドポイントを提供します。どちらも身元が必要です。

```sh
# 1 本のアーカイブ
curl -X POST http://localhost:7070/api/archives/<id>/url
# → { "url": "http://…?X-Amz-Signature=…", "expiresIn": 300 }

# 見てよいものを新しい順に
curl http://localhost:7070/api/archives
```

どちらのリクエストも形は route の JSON Schema で決まっています。説明ではなく
検査そのものが契約です。

|                              |          |                                                     |
| ---------------------------- | -------- | --------------------------------------------------- |
| `POST /api/archives/:id/url` | `id`     | UUID。違えば **400**（認可より前に落ちる）          |
| `GET /api/archives`          | `before` | ISO 8601 の日時。違えば **400**。省略すると最新から |

`before` はカーソルで、直前に受け取った最後の行の `capturedAt` を渡します。
知らないクエリパラメータは拒否ではなく削除されます。

読んではいけない相手には **403 ではなく 404** を返します。403 は
「その ID のアーカイブは実在する」ことを confirm してしまい、これは
OWASP API1:2023 (Broken Object Level Authorization) が警告する列挙の
手がかりそのものです。「見てはいけない」と「存在しない」は
区別できてはいけません。

:::note[署名の直前が唯一の強制点]
S3 は署名しか見ないので、URL を署名した瞬間に判断は確定し、取り消せません。
署名の直前以外のチェックはすべて助言的なものです。有効期限が短いのも
同じ理由で、**署名付き URL は取り消せない**以上、その寿命が
「アクセス権を剥奪してから実際にアクセスが止まるまで」の消せない隙間になります。
:::

単発の Check は `HIGHER_CONSISTENCY` で行います ― ここでキャッシュから
「許可」を返すと、寿命いっぱい有効な URL を渡してしまうからです。
一覧はそうしません。一覧に出ること自体は何の権限も与えず、
実際に取得するには上の強整合な Check を通る必要があるからです。

## 実行を起こす

**いつ**クロールするかを決める仕事は waggle の外 —— スケジューラのもの。**何を**
**どう**投げるかはここに残る。だから境界は、実行を起こす口と、その様子を返す口の 2 つ。

```sh
# 1 回起こす。すぐ返る。実行はそのまま走り続ける。
curl -X POST http://localhost:7070/api/runs \
     -H 'content-type: application/json' -d '{"limit": 5}'
# → 202 { "runId": "e5f4c0bf-…" }

curl http://localhost:7070/api/runs/e5f4c0bf-…
# → { "status": "succeeded", "submitted": 5, "accepted": 5, "rejected": 0, … }
```

実行は数十分に達しうる —— 受理された取り込みを 1 件ずつ待つため —— ので、この呼び出しに
同期の形は無い。**202 は受理であって完了ではない。** 結果が住むのは `runs` の行。

`status` が語るのは実行そのものであって、何が取れたかではない。投げたものが全部拒まれても
`succeeded` で終わる —— 最後まで走ったのは事実で、何が起きたかは `accepted` / `rejected`
が言う。`failed` になるのは実行が例外で落ちたときだけ。

### 同時に 1 本

走行中に 2 本目を起こすと **409**。これは行儀の問題ではない。gRPC の channel はプロセスに
1 つで、`configureClient` は既存を閉じ、`runClient` は終わりにもう一度閉じる —— 1 つの
プロセスで 2 本並べると、互いの接続を畳む。

担保はアプリの旗ではなく、部分 unique index:

```sql
CREATE UNIQUE INDEX runs_single_active_idx ON runs ((true)) WHERE status = 'running'
```

プロセスの中の旗は、プロセスが 2 つになった日まで**しか**保たない。Postgres はどちらでも
保つ。route の仕事は、制約違反を 409 に翻訳することだけ。

:::caution[CLI はこの担保の外に居る]
`pnpm run capture` は別のプロセスで走り、`runs` に行を作らないので、上の index からは
見えない。**互いを壊しはしない** —— gRPC の channel はモジュールの状態で、それはプロセス
ごとに別なので、入口はそれぞれ自分の channel を持つ。代わりに起きるのは **同じ対象を
2 度投げること**。どちらも `capture_targets` の有効な行を読むので、両方の選択に入った URL は
2 度取り込まれ、2 度課金され、2 度保存される。実測: API 経由の 5 件と `--limit 1` の CLI を
並走させると、同じ URL に `capture_submissions` の行が 2.3 秒差で 2 本並んだ。

channel をリクエスト単位にしても塞がらない —— 重なりはプロセスを跨いでいて、プロセス
ごとの channel は既にそうなっているため。塞ぐなら CLI にも `runs` の行を作らせ、同じ index
に守らせること。それまでは、2 つの入口は運用上の取り決めとして排他に扱う。

実行の途中でプロセスが死ぬと、その行は `running` のまま残り、次を塞ぐ。判断できるように
`GET` は `startedAt` を返す。片付けは手で行う。
:::

### 呼び出し元が渡せるもの

body が受けるのは `limit` だけ。知らない鍵は**黙って落とさず** **400**。取り込む形式は
意図して受けない —— それは「この配備が何をするか」の一部であって、環境から来る。

```sh
WAGGLE_API_RUN_FORMATS=wacz   # カンマ区切り: png,webp,html,links,mhtml,wacz
WAGGLE_API_RUN_SIGNING=1      # wacz-auth 署名を要求する。wacz が要る
```

どちらも**起動時に**読んで検査するので、綴りを間違えるとその値を名指しして起動が止まる。
実行のたびに解釈すると、打ち間違いは夜中の定期実行が「形式が 1 つも無い」で落ちて初めて
見つかる —— しかもその文言は、原因になった設定に一言も触れない。

### 誰がこの口を叩くか

waggle の中には誰も居ない。スケジューラは別の repo —— [forage](https://github.com/uraitakahito/forage)
—— に住んでいて、そこで動く Windmill が cron でこの endpoint を叩くことだけをしている。

分けてあるのは意図的で、**forage が「いつ」を決め、waggle が「何を」決める**。
body が取り込む形式を受けないのも、対象が呼び出し元の渡す一覧ではなく
`capture_targets` なのも、同じ線の上にある。

呼ぶ側が外してはならないことが 2 つあり、forage のスクリプトはそれを形にしたもの:

- **409 は失敗ではない。** 既に走っているという意味で、再試行しても答えは変わらない
  —— その 1 本が終わるまで同じ 409 が返る。
- **202 は終わりではない。** 失敗した実行も 202 を返している。202 で止める実装は、
  失敗した取り込みを成功として報告する。

スケジューラで動かすということは JWT で動かすということで、代償がひとつある。
`WAGGLE_OIDC_ISSUER` を立てると JWT の resolver が優先されるので、
**ブラウザの picker が 401 になる**。JWT が dev ヘッダより強いのは狙いどおり
（両方設定された配備で弱いほうへ落ちないため）なので、2 つは同時にではなく
使い分ける。

### 誰が起こしてよいか

組織に対する `can_submit`。取り消しが即座に効くよう `HIGHER_CONSISTENCY` で訊く。
許されていない呼び出し元には **404** —— アーカイブの route と同じ理由。

この権限は**保存する**。そこが肝:

```sh
pnpm run fga:grant submitter alice acme
pnpm run fga:revoke submitter alice acme
```

所属で代用してはならない。組織は呼び出し元自身のトークンから組んだ contextual tuple として
届くので、`can_submit: member` のような規則は「member だと言った者に member か訊く」形に
なり、必ず true になる。最初そう書いて、往復がそれを捕まえた —— 何の関係も無い組織を名乗った
subject に 202 が出た。

分かれ目は権威の在処。**誰であるか**（どの組織に属するか）を言うのは IdP なので保存しない。
**何をしてよいか**を言うのは OpenFGA なので保存する。`grant` が `member` を書くことを拒む
のは、まさにこのため —— 1 つの事実に住処が 2 つあると、食い違ったとき答えが無くなる。

なお、許可が 1 つあれば実行は起こせて、実行は**全組織の**有効な対象を投げる。`submitter`
は、その全部を任せられる相手にだけ与えること。

## リンクを辿る

`POST /api/crawls` は種を受け取り、そこからリンクを辿る。辿る作業は Windmill が回し、
**範囲・既読・打ち切り**を決めるのは waggle。

```sh
curl -X POST http://localhost:7070/api/crawls \
     -H 'content-type: application/json' \
     -d '{"seed":"https://example.com/","maxDepth":2,"perHostDelayMs":2000}'
# → 202 { "crawlId": "9072b625-…" }

curl http://localhost:7070/api/crawls/9072b625-…
# → { "state": "succeeded", "stopReason": "max_pages",
#     "pagesCaptured": 6, "pagesDiscovered": 76, … }
```

`WAGGLE_CRAWL_WEBHOOK_URL` と `_TOKEN` の両方が無ければ、この口は出さない。片方だけだと
**起動時に落とす** —— 半端な設定は、頼まれた後にしか気づけない失敗になり、そのときには
行が既に立っている。

### 相手に負荷をかけないために

クロールごとの設定が 3 つ:

|                   | 既定 |                                                            |
| ----------------- | ---- | ---------------------------------------------------------- |
| `perHostDelayMs`  | 2000 | 同じホストで、**前が終わってから**次を**投げる**までの間隔 |
| `hostParallelism` | 4    | 同時に触るホストの数                                       |
| `maxPages`        | 30   | 種を含む総ページ数                                         |

間隔を「投入から」ではなく「**完了から**」測るのが肝。BrowserHive のキューに容量制限は
無く、投入は決して拒まれない —— 同時に走る数を決めているのは worker の数だけ。だから
投入を間引いても意味がない。3 件まとめて投げれば、キューの中で連続して実行される。
相手が間隔を感じるのは、取り込みが終わった後に空けたときだけ。

そして 1 回の取り込みは 1 リクエストではない。ブラウザはサブリソースまで取るので、
1 ページが相手には数十本のバーストに見える。2000ms はそれを踏まえた値で、robots.txt の
`Crawl-delay` が長ければそちらが勝つ —— 相手が言っている値をこちらの都合で縮めない。

:::note[間隔は信じるものではなく、測るもの]
`crawl_pages` がページごとに `submitted_at` と `finished_at` を持つのは、まさに後から
確かめるため:

```sql
SELECT lag(finished_at) OVER w AS prev, submitted_at
FROM crawl_pages WHERE crawl_id = $1
WINDOW w AS (PARTITION BY host ORDER BY submitted_at);
```

差はすべて `per_host_delay_ms` 以上で、**負であってはならない**。負の差は、同じホストへの
取り込みが重なったという意味。どちらの失敗も、時刻が無ければ「速く動いた」と見分けが付かない。
:::

### クロールは同時に 1 本

走行中に 2 本目を起こすと **409**。`runs` と同じく部分 unique index が守る。ただし理由は
違う —— 上の間隔は **1 つの flow run の中でしか効かない**ので、2 本走ると互いの間隔が
見えず、同じホストへの頻度が黙って倍になる。

### どこで、なぜ止まったか

`stopReason` は `completed` / `max_depth` / `max_pages` / `failed` のいずれか。これが無いと、
終わったクロールが「全部辿った」のか「切られた」のかを言えない。既定の 30 ページでは
**`max_pages` で止まるのが普通** —— 上限が日常的に見えているほうがよいので、そう選んである。

`pagesDiscovered` と `pagesCaptured` は別々に持つ。差が「範囲・robots・上限で落としたぶん」。

### 何を辿るか

既定は種と同じ origin（`scope: "same-host"` にするとホスト単位に緩む）。判定は
リダイレクト後の **最終 URL** に対して行う。`rel="nofollow"` は尊重し、`http(s)` 以外は
辿らない。フラグメントは落とす —— `#section` はページの中の位置であって別のページではない
—— が、それ以外は正規化しない。クエリを並べ替えると別のページを返すサーバは実在するので、
取りこぼしより取り違えのほうが悪い。

重複排除は `(crawl_id, url_hash)` の unique index 1 本。`url_hash` は `capture_targets` と
同じ `digest(url, 'sha256')` の生成列。見つけたリンクは `ON CONFLICT DO NOTHING` で入れ、
**実際に入った行がそのまま次の段になる** —— 記録と決定がずれようがない。BrowserHive の
`rejectDuplicateUrls` は代わりにならない: pending と processing しか見ておらず、完了した
URL を忘れる。

## 全文検索

既定では立ちません。索引を持たない配備がありうるので、`WAGGLE_OPENSEARCH_URL` を
設定しない限り **口ごと出しません**（404 が返ります ― その配備にこの能力は本当に
無いので、正しい答えです）。

```sh
container-compose --profile search up -d -b
# .env に WAGGLE_OPENSEARCH_URL=http://127.0.0.1:9200
```

```sh
# クロール 1 本ぶんを索引に載せる（クロールの flow が最後に自動で叩きます）
curl -X POST .../api/crawls/<id>/index
# → 202 { "indexed": 6, "pages": 6 }

# 引く
curl ".../api/search?q=responsive"
# → { "hits": [ { "archiveId": "…", "url": "…", "title": "responsive", … } ], "total": 3 }
```

### 本文はアーカイブから採ります

BrowserHive が WACZ の `pages/pages.jsonl` に `title` と `text` を書いています。
`text` の出どころは `document.body.innerText` ― **描画後の本文**であって HTML では
ありません。waggle はそれをそのまま索引に載せます。HTML から起こし直すと、
アーカイブが署名して主張している内容と索引が食い違いえます。

`textWithheld`（`url-policy` / `content-type`）も一緒に運びます。捨てると
**取り込みが空だった**のと**方針が保存を禁じた**のが同じ見た目になります。
前者は調べるべき異常で、後者は正常な運用です。

### 索引は誰に見せてよいかを知りません

検索は OpenSearch に問い合わせてから、返ってきたぶんについて OpenFGA に
`can_view` を訊いて絞ります。`GET /api/archives` と同じ形です。

索引に組織や権限を写せば問い合わせ 1 回で絞れて速いのですが、そうすると
**索引が認可の権威になり、1 つの事実に住処が 2 つできます**。片方を直しても
両方とも動いているように見えるので、認可の素通りが静かに残ります。

:::caution[件数とページングは正確ではありません]
`total` は索引が数えた生の件数で、**認可で落ちたぶんを含みます**。50 件求めて
30 件返ることがあります。見てよいものだけを数えるには数える前に認可を掛ける
しかなく、それは上の「索引に権限を持たせる」に戻ります。数の正確さより、
権威が 1 つであることを採っています。
:::

### 作り直すのは 1 文です

```sql
UPDATE archives SET indexed_at = NULL;
```

索引の状態は `archives.indexed_at` の列 1 つで、本文は保存していません
（必要なものは台帳の行と S3 から全部導けます）。そのため解析器や mapping を
変える判断が安く済みます。

いまの解析器は組み込みの `cjk`（bigram）です。kuromoji はプラグインの導入が要り、
既製イメージでは動きません ― 必要になったら自前イメージに替えて、上の 1 文で
作り直してください。

## ブラウザからアーカイブを選ぶ

`waggle-api` は `/` に picker も出す —— 上の一覧を画面にしたもので、行をクリックすると
[replay](https://github.com/uraitakahito/replay) で開く。

```sh
pnpm run api                  # host 側。スタックに waggle-api のサービスは無い
open http://127.0.0.1:7070/
```

これには中身の入った `.env` が要ります（[セットアップ](#セットアップ)を参照）。
`WAGGLE_DEV_IDENTITY=1` が無くても API は起動しますが、resolver が誰も通さないので
picker は `401` で空のままになります。

picker が replay に渡すのは `objectKey` だけ:

```
http://127.0.0.1:8899/?source=/wacz/<objectKey>
```

署名付き URL は使わない。あれは S3 を直接指すので viewer から見て別 origin になり、
bucket に CORS が要る。object key なら読みは replay 自身の上流を通るので、
**replay は一切変えなくてよい**。

:::caution[絞っているのは一覧だけで、読みではない]
`can_view` が決めるのは picker に出るかどうか。`/wacz/<key>` を**守ってはいない** ——
その経路は bucket の匿名 read で配られるので、鍵を知っていれば誰でも読める。
絞り込みが決めるのは「何を見せるか」であって「何を取れるか」ではない。

ここを閉じるなら署名付き URL を渡し、bucket に CORS を設定することになる。
それは別の変更。
:::

## 身元

呼び出し元の**認証**は認可とは別の問題で、まだ IdP が決まっていません。
認可層が必要とするものは小さく安定している（subject と所属組織）ので、
その形だけ固定し、裏の検証は差し替え可能にしてあります。

**既定では誰も認証されず、すべて 401 です。**
ローカル開発では `WAGGLE_DEV_IDENTITY=1` で、2 つのヘッダを信用する
リゾルバが有効になります:

```sh
curl -X POST http://localhost:7070/api/archives/<id>/url \
  -H 'X-Waggle-Subject: bob' \
  -H 'X-Waggle-Organizations: acme'
```

ポートに到達できる人は誰にでもなりすませます。明示的に有効化しない限り
動かず、起動時に警告を出します。

CLI も同じ形の身元を持ちますが、経路が違います。ヘッダの来ない場所なので、
`WAGGLE_DEV_SUBJECT` と `WAGGLE_DEV_ORGANIZATIONS` の 2 つの環境変数を読みます
（`setup.sh` が `.env` に書きます）:

```sh
WAGGLE_DEV_SUBJECT=bob WAGGLE_DEV_ORGANIZATIONS=acme pnpm run capture --wacz
```

こちらも**検証は一切しません**。`.env` を書き換えれば誰にでもなりすませます。
それでも置いてあるのは、これが `capture_submissions.submitted_by` と
`capture_job` の `owner` tuple になるからで、空のままだと**投げた本人ですら
アーカイブを削除できません**（`can_delete` は `owner from parent` だけを見ます）。

API 側の `WAGGLE_DEV_IDENTITY=1` に相当するスイッチは CLI にはありません。
未設定なら起動時に落ちます。API はネットワークに口を開けるので既定を
「拒否」にしていますが、CLI は手元の道具なので、危ないのは逆側 ——
黙って空のまま通されて、記録が嘘になることです。

どちらの経路も `src/config/identity.ts` の 1 つの関数に行き着きます。IdP が
決まったとき差し替えるのはそこだけで、呼ぶ側は `Identity` 型しか見ていません。

所属は OpenFGA に**保存していません**。リクエストごとに呼び出し元の身元から
contextual tuple として渡すので、入退社や組織変更を認可ストアへ同期する
必要がそもそも生じません。代償は**剥奪がトークンの失効待ちになる**ことで、
だからトークンは短命であるべきです。

## 認可モデル

型は 4 つで、所有は**組織 → ジョブ → アーカイブ**と上から流れます。

| 型             | 関係                                                     |
| -------------- | -------------------------------------------------------- |
| `user`         | —                                                        |
| `organization` | `member` / `admin`                                       |
| `capture_job`  | `owner` / `parent`（組織）/ `member`                     |
| `archive`      | `parent`（ジョブ）/ `viewer` / `can_view` / `can_delete` |

署名エンドポイントが聞くのは `can_view` ただ 1 つで、そこに至る道は 3 本です。

```
define can_view: viewer or owner from parent or member from parent
```

| 道                   | 誰が                       | どこから来るか                       |
| -------------------- | -------------------------- | ------------------------------------ |
| `viewer`             | 組織の外へ直接共有された人 | タプル（**必ず期限つき**）           |
| `owner from parent`  | そのジョブを頼んだ本人     | タプル                               |
| `member from parent` | 所有組織の一員             | **contextual tuple**（トークン由来） |

削除は所有者だけです（`can_delete: owner from parent`）。
**組織のメンバーは見られますが、消せません。**

:::note[`capture_job.member` は中継のために在る]
`archive` から `organization#member` へ直接届きそうに見えますが、届きません。
**`from` は辺をちょうど 1 本しか辿らない**ためです。`archive#parent` が指すのは
`capture_job` なので、そこから見た「組織のメンバー」は 2 段先にあります。

```
type capture_job
  relations
    define parent: [organization]
    define member: member from parent   # ← その足りない 1 段
```

:::

### 共有は自分で期限切れになる

組織の外へ渡すとき、期限なしでは渡せません。`viewer` の型が条件付きだからです。

```
define viewer: [user with non_expired_grant, organization#member]

condition non_expired_grant(current_time: timestamp, grant_time: timestamp, grant_duration: duration) {
  current_time < grant_time + grant_duration
}
```

`current_time` は Check のたびに渡されるので、**期限切れのタプルを掃除する仕組みが
要りません**。タプルは残ったまま条件が偽になるだけで、掃除役が止まっていても
穴は開きません。

### アサーションが守っているもの

`fga/model.fga.yaml` の 7 本は、どれも「誰かが不当に見られる」形の壊れ方を
指しています。

| #   | 問い                                           |
| --- | ---------------------------------------------- |
| 1   | ジョブの所有者は、それが生んだものを見られる   |
| 2   | 所有組織のメンバーは**見られるが、消せない**   |
| 3   | 無関係な人には何も見えない                     |
| 4   | **別の組織のメンバーであることは何も与えない** |
| 5   | 直接の共有は、その窓の中では見える             |
| 6   | **同じ共有が、窓を過ぎると見えない**           |
| 7   | 共有された相手でも、削除はできない             |

5 と 6 は**タプルが完全に同一で、`current_time` だけが違います**。

### 検証と投入

`fga/model.fga` が真実で、`fga/model.fga.yaml` のアサーションが CI で走ります:

```sh
pnpm run fga:test    # サーバ不要でモデルを検証
pnpm run fga:deploy  # モデルを投入し、固定すべき ID を出力
```

`fga:deploy` は `WAGGLE_FGA_STORE_ID` と `WAGGLE_FGA_MODEL_ID` を出力します。
**モデル ID は固定してください。** モデルはイミュータブルで書き込むたびに
新しい ID が発行されるため、ID を省略すると常に最新で評価され、
**モデルを書き換えた瞬間にすべての判断が一斉に変わります**。
環境変数を上げる操作が、その切り替えを意図的な行為にします。

## セットアップ

```sh
./setup.sh                    # .env.example から .env を作る（25 個）
container-compose up -d -b
pnpm run fga:migrate          # OpenFGA のスキーマ（下記参照）
pnpm run db:migrate
pnpm run fga:deploy           # → 出力された 2 つの ID を .env に貼る
pnpm run api
```

どれも `.env` を読みます（`pnpm run` の各スクリプトが
`--env-file-if-exists=.env` を渡しています）。必須は 7 個で、うち 2 個
（`WAGGLE_FGA_STORE_ID` と `WAGGLE_FGA_MODEL_ID`）は `fga:deploy` を走らせるまで
存在しません。この手順が `api` より前にあるのはそのためです。`.env.example` が
実際の読み取りとずれていないかは `scripts/check-env.mjs` が見ています。

:::caution[`fga:migrate` が独立した手順である理由]
`openfga` イメージは distroless なので、seaweedfs のように entrypoint で
シェルのリトライループを回せず、container-compose にワンショットの
サービスもありません。サーバは未マイグレートの DB に対しても普通に起動し、
これを実行するまで **`/healthz` を含むすべてに 500 を返します**。

またデータストアの指定は環境変数ではなくコマンドラインフラグで行っています。
container-compose が注入する Docker link 風の変数を OpenFGA の設定ローダーが
拾って誤読し、環境変数で渡すと
`storage engine '192.168.64.202' is unsupported`（DB コンテナの IP アドレス）
で panic しました。
:::
