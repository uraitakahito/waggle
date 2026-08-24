---
title: tuple
description: OpenFGA が保存する実体。索引が 2 方向あることに設計が出ている。
---

**関係そのもの。** OpenFGA が保存する実体は、ほぼこれ 1 枚です。

:::caution[読んでよいが、書いてはいけない]
直接 `INSERT` / `UPDATE` すると、OpenFGA のキャッシュや `changelog` と食い違います。
**変更は必ず HTTP API（Write）経由**で行ってください。SQL で見るのは、中がどう
なっているかを理解するためです。
:::

```sql
 store             | text        -- すべての行が store で仕切られる
 object_type       | text        -- ┐
 object_id         | text        -- │「何に」を 2 列に割っている
 relation          | text        -- │
 _user             | text        -- ┘「誰が」（人とは限らない）
 user_type         | text        -- 'user' / 'userset'
 ulid              | text        -- 書き込み順を保つ ID
 inserted_at       | timestamptz
 condition_name    | text        -- ┐ 条件つき tuple のためだけに在る
 condition_context | bytea       -- ┘
```

`_user` のアンダースコアは、**`user` が SQL の予約語だから**です。

## 「誰が」は人とは限らない

waggle の実データを見ると分かります。

```
 object                    | relation | _user
---------------------------+----------+---------------------------
 archive:c36c4879-…        | parent   | capture_job:89b1dcb5-…
 capture_job:89b1dcb5-…    | parent   | organization:acme
 archive:6ef44ae1-…        | parent   | capture_job:89b1dcb5-…
```

`_user` の欄に入っているのは `capture_job` や `organization` です。**この列は
「関係の主語」であって、人の欄ではありません。** だから親子関係もこの 1 枚で
表せます。

## 索引が 2 方向ある

```sql
tuple_pkey       PRIMARY KEY (store, object_type, object_id, relation, _user)
idx_user_lookup  (store, _user, relation, object_type, object_id)

idx_tuple_partial_user     … WHERE user_type = 'user'
idx_tuple_partial_userset  … WHERE user_type = 'userset'
idx_tuple_ulid   UNIQUE (ulid)
```

| 索引              | 並び                     | 答える問い                                 | 使うのは    |
| ----------------- | ------------------------ | ------------------------------------------ | ----------- |
| `tuple_pkey`      | object → relation → user | **この object に繋がっているのは誰か**     | Check       |
| `idx_user_lookup` | user → relation → object | **この user が繋がっている object は何か** | ListObjects |

**同じデータを 2 方向から引く必要があるので、索引も 2 本要ります。** これが
ReBAC の実装コストの一端です。

## 条件は列として持つ

`condition_name` / `condition_context` があることから、**「7 日だけ共有」のような
条件は別テーブルではなく tuple そのものに貼り付く**と分かります。条件つきの線と
そうでない線が、同じ表に同居します。

waggle のモデルでは、組織の外への直接共有だけが条件つきです。

```
define viewer: [user with non_expired_grant, organization#member]
```

## Check がここをどう読むか

OpenFGA は**「誰が何を見られるか」の表を事前に作りません**。聞かれるたびに、この
表を辿ります。

```
「alice は archive:X を見られるか?」
  → archive:X の parent は? …… tuple を引く
  → その capture_job の owner は? …… tuple を引く
  → その組織の member は? …… contextual tuple（保存されていない）
```

だから**深さに上限があります**。手元の v1.10.2 で測ると、深さ 25 までは答えが返り、
26 以上は `authorization_model_resolution_too_complex` になりました。

## 覗き方

```sh
container exec openfga-db.waggle psql -U openfga -d openfga -c "\d tuple"

container exec openfga-db.waggle psql -U openfga -d openfga \
  -c "SELECT object_type||':'||object_id AS object, relation, _user FROM tuple"
```
