---
title: URL ソース
description: waggle が読む urls テーブルと、その運用方法。
---

waggle の入力は Postgres のテーブル 1 つだけです。**waggle 自身は INSERT しません** —
`urls` への投入は呼び出し側の責務で、手動 `INSERT` でも、外部パイプラインでも、
同梱の seed でもかまいません。

## クエリ

毎回の実行はこれだけです。

```sql
SELECT url, labels FROM urls WHERE enabled ORDER BY id ASC [LIMIT $1]
```

`ORDER BY id ASC` なので**登録順に投げられ**、`--limit` は先頭 n 件を取ります。
つまり動作確認では常に同じ URL が対象になります。

## スキーマ

```ts file="src/db/migrations/001-create-urls.ts#urls-columns"

```

| カラム                      | 補足                                                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `id`                        | `BIGSERIAL` 主キー。投入順で、ローダの `ORDER BY` がそれを保つ。                                                      |
| `url`                       | `CHECK (url <> '' AND url = btrim(url))` — 空文字と前後空白をデータベースが拒否するので、CLI 側で検査する必要がない。 |
| `url_hash`                  | 生成列 `digest(url, 'sha256')` (pgcrypto) を stored 保存。ユニークインデックスの土台で、直接読むことはない。          |
| `labels`                    | `TEXT[]`。そのまま BrowserHive に送られ、成果物のファイル名に組み込まれる。                                           |
| `enabled`                   | ホットパスは `WHERE enabled` で、部分インデックス `urls_enabled_id_idx` が覆う。無効行はコストにならない。            |
| `created_at` / `updated_at` | `now()` 既定。自動更新トリガは今のところ無い。                                                                        |

`urls_url_hash_key` はユニークなので、同じ URL を二重に登録できません。

## labels の使い方

labels は自由形式で、成果物のファイル名に入ります。そのため**外部キーを持たせる
場所**として自然です。同梱のサンプルは証券コードと社名を並べています。

```ts
{ url: "https://www.ana.co.jp/group/", labels: ["9202", "ANAHoldings"] }
```

## URL を追加する

```sql
INSERT INTO urls (url, labels) VALUES
  ('https://example.com/', ARRAY['example']),
  ('https://example.org/', ARRAY['example', 'org'])
ON CONFLICT (url_hash) DO NOTHING;
```

履歴を残したまま対象から外したいときは、行を削除せず `enabled = false` にします。

## マイグレーション

マイグレーションは `src/db/migrations/<NNN>-<説明>.ts` に置き、`up(db)` /
`down(db)` を export します。ランナーは Kysely の `Migrator` +
`FileMigrationProvider` の薄いラッパで、適用済み ID を `kysely_migration`
テーブルで管理します (同時実行は `kysely_migration_lock` が守ります)。最新の状態で
`pnpm run db:migrate` を再実行しても何も起きません。

```sh
pnpm run db:migrate       # 適用
pnpm run db:migrate:down  # 直前の 1 つを巻き戻す
```

追加するときは:

1. 次の連番を取る (例 `002-add-priority.ts`)。
2. スキーマビルダで `up` / `down` を実装する。ビルダで書けないもの (拡張、生成列、
   他カラムを参照する `CHECK`) は ``sql`…`.execute(db)`` を使う。
3. ローカルで往復させる:
   `pnpm run db:migrate && pnpm run db:migrate:down && pnpm run db:migrate`。
   CI も同じ往復を実行します。
4. マイグレーションと、それに依存するコードは同じ PR でコミットする。

seed も `src/db/seeds/` に同じ形で置きますが、記録は `kysely_seed` と別なので、
マイグレーションとは独立に適用・巻き戻しできます。
