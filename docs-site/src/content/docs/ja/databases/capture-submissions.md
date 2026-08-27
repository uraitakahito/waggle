---
title: capture_submissions
description: 投げた瞬間に「誰のために投げたか」を残すテーブル。組織を知る唯一の出どころ。
---

**投げた瞬間に「誰のために投げたか」を残すための表です。**

```ts file="src/db/migrations/004-create-capture-submissions.ts#capture-submissions-columns"

```

## なぜ必要か

**BrowserHive に「組織」という概念はありません。** 取り込みを投げるとき waggle は
URL と設定だけを渡し、返ってくるのは `taskId` です。

後から bucket の `.result.json` を拾って台帳を埋めるとき、その manifest には
**組織を特定するものが何も入っていません**。だから投げた瞬間にここへ記録して
おくのが唯一の出どころになります。

```
waggle が知っている        BrowserHive が知っている
─────────────────          ─────────────────────
urls.org_id       ──┐      taskId
                    │      成果物の場所
                    └──→   （組織は知らない）
              capture_submissions
              task_id → org_id の対応
```

この行が無いと、reconciler は「このアーカイブは誰のものか」を言えません。

## 書かれ方

`run.ts` が、受理された取り込みについてまとめて 1 回書きます。

```ts
await db
  .insertInto("captureSubmissions")
  .values(accepted.map((r) => ({ taskId: r.taskId, orgId: r.orgId, ... })))
  .onConflict((oc) => oc.column("taskId").doNothing())
  .execute();
```

**取り込みを待ち始める前に書きます。** 待っている間にプロセスが落ちても、
帰属の情報だけは残るためです。

`taskId` が再投稿されることはありません（server が採番するため）が、**この関数
自体が再実行されることはある**ので `onConflict … doNothing()` を置いています。

## 読まれ方

`reconcile.ts` が、bucket の manifest から台帳を埋めるときに引きます。

```
.result.json から taskId を得る
  → capture_submissions で org_id と submitted_by を引く
  → archives に登録し、その org_id と submitted_by で tuple を積む
```

## 列の要点

| 列             | 要点                                                                  |
| -------------- | --------------------------------------------------------------------- |
| `task_id`      | **主キー。** BrowserHive が採番したもので、結果の報告へ戻る join の鍵 |
| `org_id`       | `not null`。**この表が在る理由そのもの**                              |
| `submitted_by` | それを求めた利用者。**人ではなく組織に属する定期実行では NULL**       |
| `source_url`   | 投げた URL。`urls` への外部キーではない（後から URL が消えても残る）  |
| `submitted_at` | `now()` 既定                                                          |

:::caution[`submitted_by` は認証の結果ではありません]
この列を埋めているのは、CLI が `WAGGLE_DEV_SUBJECT` から読んだ値です
（[身元](/waggle/ja/archive-ledger/#身元)）。**検証は一切されません** ——
`.env` を書き換えれば誰の名前でも入ります。

それでも `null` のままにしないのは、この値がそのまま `capture_job` の
`owner` tuple になるからです。埋まっていないアーカイブは、
[`can_delete`](/waggle/ja/archive-ledger/#認可モデル) が `owner from parent`
だけを見るので、**誰にも削除できません**。
:::

:::note[台帳と件数が一致しません]
この表には**投げたものすべて**が入りますが、[`archives`](/waggle/ja/databases/archives/)
に入るのは**アーカイブを生んだものだけ**です。失敗した取り込みは何もアップロード
していないので、差が出るのが正常です。
:::
