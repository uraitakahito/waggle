---
title: データベース
description: waggle と OpenFGA がそれぞれ持つ Postgres と、その中にある 14 のテーブル。
---

waggle の開発スタックには **Postgres が 2 つ**あります。別々のものを入れる、
別々のデータベースです。

| コンテナ            | 中身                                             | 誰が SQL で触るか |
| ------------------- | ------------------------------------------------ | ----------------- |
| `postgres.waggle`   | `urls` / `archives` / `fga_outbox` ほか **8 表** | waggle            |
| `openfga-db.waggle` | `tuple` / `authorization_model` ほか **6 表**    | OpenFGA だけ      |

重なるテーブルは 1 つもありません。資格情報も相互に通らず、`openfga-db` は
ポートを公開していないので、覗くには `container exec` が要ります。

## なぜ分けたのか

同じインスタンスに同居していると、`tuple` を waggle のトランザクションの中で
書けるかのように錯覚します。**実際には書けません** — OpenFGA へは HTTP API 経由
でしか書かず、SQL では書かないので、両方にまたがるトランザクションは存在しません。

分けておけば、その錯覚が起きる余地が物理的に消えます。そして分けた結果として
[`fga_outbox`](#fga_outbox) が必要になります。

## waggle の DB

### urls

撮る対象の一覧。waggle が答える唯一の問い「どの URL を撮るか」の答えです。

列の詳しい説明は [URL ソース](/waggle/ja/url-source/)にあります。

### capture_submissions

```ts file="src/db/migrations/004-create-capture-submissions.ts#capture-submissions-columns"

```

**投げた瞬間に「誰のために投げたか」を残すための表です。** BrowserHive に組織と
いう概念は無いので、後から bucket の `.result.json` を拾って台帳を埋めるとき、
その manifest には組織を特定するものが何も入っていません。ここが唯一の出どころ
になります。

### archives

```ts file="src/db/migrations/002-create-archives.ts#archives-columns"

```

**台帳。成功した取り込みが 1 本につき 1 行**です。失敗したものは何もアップロード
していないので、記録すると署名エンドポイントが存在しないオブジェクトの URL を
配ることになります。

`(bucket, object_key)` が UNIQUE なので、poller と reconciler の両方が同じ取り込みに
辿り着いても重複しません。

:::note[所有者の列が無いことに意味があります]
`owner_id` も `org_id` もありません。**誰が読んでよいかは「関係」であり、OpenFGA が
持ちます。** 同じ問いへの答えを 2 か所に置けば、いずれ食い違うからです。
:::

投げた件数と台帳の行数は一致しません。これは壊れているのではなく、**台帳に入るのは
アーカイブを生んだ取り込みだけ**という設計です。

### fga_outbox

```ts file="src/db/migrations/003-create-fga-outbox.ts#fga-outbox-columns"

```

**OpenFGA へ「送る予定」の tuple を溜める箱**です。名前に `fga` と付きますが
waggle 側の表で、`payload` にはこういう JSON が入ります。

```json
{
  "writes": [
    { "user": "capture_job:7f170ae4-…", "object": "archive:3a4cb75c-…", "relation": "parent" },
    { "user": "organization:acme", "object": "capture_job:7f170ae4-…", "relation": "parent" }
  ]
}
```

アーカイブの行と同じトランザクションで書かれるので、**両方入るか、どちらも入らないか**
です。配送は `waggle-ledger drain` か API のタイマーが行い、OpenFGA に受理されるまで
再送します。詳しくは[アーカイブ台帳](/waggle/ja/archive-ledger/)を参照してください。

### Kysely が作る 4 表

`kysely_migration` / `kysely_migration_lock` / `kysely_seed` / `kysely_seed_lock`。

**自分で設計したものではなく、Kysely が勝手に作って勝手に更新します。** 中身は
「どの migration をもう流したか」の 2 列（`name` / `timestamp`）だけで、`_lock` の
ほうは 1 行だけの鍵です。同じ runner を、記録用のテーブルだけ変えて migration と
seed に使い回しています。

## OpenFGA の DB

**このデータベースは読むことはあっても、書いてはいけません。** 直接 `INSERT` や
`UPDATE` をすると OpenFGA のキャッシュや `changelog` と食い違います。変更は必ず
HTTP API 経由です。

```sh
# 中を見るには container exec から (ポートを公開していないため)
container exec openfga-db.waggle psql -U openfga -d openfga -c "\dt"
```

### tuple

**関係そのもの。** OpenFGA が保存する実体はほぼこれ 1 枚です。

| 列                                     | 役割                            |
| -------------------------------------- | ------------------------------- |
| `store`                                | すべての行が store で仕切られる |
| `object_type` / `object_id`            | 「何に」を 2 列に割っている     |
| `relation`                             | どういう関係で                  |
| `_user`                                | 「誰が」— 人とは限らない        |
| `user_type`                            | `user` / `userset` の区別       |
| `condition_name` / `condition_context` | 条件つき tuple のためだけに在る |

`_user` のアンダースコアは、`user` が SQL の予約語だからです。実データを見ると
`capture_job:…` や `organization:acme` が入っており、「誰が」の欄が人とは限らない
ことが分かります。

**索引が 2 方向あります。**

- 主キー `(store, object_type, object_id, relation, _user)` — 「この object に
  繋がっているのは誰か」。Check がこちらを使います
- `idx_user_lookup (store, _user, relation, object_type, object_id)` — 「この user が
  繋がっている object は何か」。ListObjects（逆引き）専用です

同じデータを 2 方向から引く必要があるので、索引も 2 本要ります。

### authorization_model

**モデル（スキーマ）。更新も削除もありません。** 書き込むたびに新しい ID が発行され、
古い行はそのまま残ります。モデル全体が `serialized_protobuf` に直列化されて入ります。

Check で ID を指定すればその版で評価され、省略すれば常に最新です。**だから
`WAGGLE_FGA_MODEL_ID` を固定します** — 固定しないと、モデルを書き換えた瞬間に
すべての判断が一斉に変わります。

### changelog

**`tuple` は現在の状態しか持ちません**（消した行は消えます）。その履歴を保つのが
この表です。`operation` は `0` が追加、`1` が削除。

用途は監査（いつ誰の権限が付き、いつ外れたか）と、Watch API による変更の購読です。

### store

1 つの OpenFGA に複数の store を置けます。tuple もモデルも store で仕切られるので、
別プロジェクトが同居できます。

:::caution[store の削除は soft delete です]
API で削除しても `deleted_at` が立つだけで、`tuple` も `changelog` も残ります
（API からは見えなくなります）。ディスクを空けたい場合は SQL で物理削除が要ります。
:::

### assertion

モデルに紐づくテストを OpenFGA 側に保存する場所ですが、**waggle は使っていません**。
テストは `fga/model.fga.yaml` としてリポジトリに置き、`pnpm run fga:test` で
サーバ不要・in-process で走らせています。だから CI ではスタックを立てずに検証できます。

### goose_db_version

OpenFGA 自身のスキーマ移行の記録です。waggle 側の `kysely_migration` と同じ役割で、
`pnpm run fga:migrate` がこれを流します。**2 つの DB がそれぞれ自分の migration 管理を
持っている**ことも、別物であることの傍証です。

## 覗き方

```sh
# waggle 側 — ホストの psql でも繋がる (5432 を公開している)
container exec postgres.waggle psql -U waggle -d waggle -c "\dt"

# OpenFGA 側 — ポート非公開なので container exec から
container exec openfga-db.waggle psql -U openfga -d openfga -c "\d tuple"
```
