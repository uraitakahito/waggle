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

## 台帳を埋める 2 つの経路

**ポーリング** ― `waggle` は投げた capture の完了を待ち
（`GetCapture`、完了するまで `PENDING` / `PROCESSING`）、成果物ができたものを
登録します。速いですが、waggle が動いている間しか効きません。
`--no-collect` で省略できます。

**Reconcile** ― `waggle-ledger reconcile` は BrowserHive が各 capture の
成果物の隣に書く `.result.json` マニフェストを走査し、台帳に無いものを
登録します。**これが台帳を自己修復させます**: waggle が何時間止まっていても、
結果が BrowserHive のキャッシュから溢れていても、次の reconcile で拾えます。

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
WAGGLE_DEV_SUBJECT=bob WAGGLE_DEV_ORGANIZATIONS=acme pnpm run dev --wacz
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
container-compose up -d -b
pnpm run fga:migrate          # OpenFGA のスキーマ（下記参照）
pnpm run db:migrate
pnpm run fga:deploy           # → 出力された 2 つの ID を export
pnpm run api
```

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
