---
title: urls
description: 撮る対象の一覧。waggle が答える唯一の問いの答えが入るテーブル。
---

**撮る対象の一覧。** waggle が答える唯一の問い「どの URL を撮るか」の答えがここに
あります。

```ts file="src/db/migrations/001-create-urls.ts#urls-columns"

```

## 読まれ方

実行のたびに 1 本のクエリで読まれます。これが唯一の読み取り経路です。

```sql
SELECT url, labels, org_id FROM urls WHERE enabled ORDER BY id ASC LIMIT $1
```

- **`WHERE enabled`** — `false` の行は投げられません。一覧から一時的に外す手段です
- **`ORDER BY id ASC`** — 順序は投入順に固定。`--limit 1` は必ず「いちばん古い行」を選びます
- **`LIMIT $1`** — `--limit` が入るのはここだけ。**URL を絞り込む条件はどこにもありません**

CLI に URL を渡す口はありません。位置引数も `--url` も、パーサが拒否します。
撮る対象を変えるのはこのテーブルへの `INSERT` です。

## 列の要点

| 列                          | 要点                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------- |
| `id`                        | `BIGSERIAL`。投入順で、ローダの `ORDER BY` がそれを保つ                                      |
| `url`                       | `CHECK (url <> '' AND url = btrim(url))` — 空文字と前後空白をデータベースが拒否する          |
| `url_hash`                  | **生成列**。`digest(url, 'sha256')` を stored 保存。ユニーク索引の土台で、直接読むことはない |
| `labels`                    | `TEXT[]`。そのまま BrowserHive に送られ、成果物のファイル名に組み込まれる                    |
| `enabled`                   | 部分索引 `urls_enabled_id_idx` が覆う。無効行はコストにならない                              |
| `org_id`                    | この URL がどの組織のものか。`capture_submissions` まで持ち回られる                          |
| `created_at` / `updated_at` | `now()` 既定。自動更新トリガは今のところ無い                                                 |

:::note[なぜ `url` に直接 UNIQUE を張らないのか]
長い URL は索引のサイズ上限に当たりえます。**32 バイト固定の SHA-256 に張る**ことで
その心配が消え、しかも生成列なのでアプリがハッシュを計算する必要もありません。
:::

## 索引

```sql
urls_pkey            PRIMARY KEY (id)
urls_url_hash_key    UNIQUE (url_hash)          -- 同じ URL は 2 度入らない
urls_enabled_id_idx  (id) WHERE enabled         -- 部分索引
```

`urls_enabled_id_idx` が**部分索引**なのは、読み取りが必ず `WHERE enabled` を
伴うためです。無効な行まで索引に入れても場所の無駄になります。

## 行を足す

```sh
container exec postgres.waggle psql -U waggle -d waggle -c \
  "INSERT INTO urls (url, labels) VALUES ('https://example.com/', ARRAY['example'])"
```

同じ URL を 2 度入れようとすると `urls_url_hash_key` で弾かれます。詳しくは
[URL ソース](/waggle/ja/url-source/)を参照してください。
