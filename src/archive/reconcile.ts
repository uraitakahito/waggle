/**
 * 台帳の穴を、bucket に永続化された結果 manifest から埋める。
 *
 * `run.ts` の polling は waggle が動いている間しか働かない。落ちていた、再起動した、
 * あるいは見に行く前に結果が BrowserHive の有界キャッシュから溢れた —— そのとき
 * その取り込みは台帳に届かず、しかも後から「欠けている」と教えてくれるものが何も
 * 無い。気づかれない穴のある台帳は、台帳が無いより悪い。穴は「なぜこのアーカイブが
 * 見えないのか」という形で、ずっと後になって表に出るから。
 *
 * BrowserHive は取り込みごとに、成果物の隣へ `.result.json` を書く。成功にも失敗にも
 * 書き、寿命は成果物と同じ。つまり bucket は完全な記録で、これはそこを歩く。
 *
 * ## 規模
 *
 * S3 の list は prefix でしか絞れない —— 拡張子での絞り込みも「いつ以降」も無い ——
 * ので、listing を全部引いてから manifest をここで選ぶ。今の規模 (数十オブジェクト)
 * なら問題ない。数万になったときの直し方は、賢い listing ではなく BrowserHive の鍵に
 * 日付の prefix を入れること。
 */
import type { Kysely } from "kysely";
import type { S3Client } from "@aws-sdk/client-s3";
import { readManifest } from "./manifest.js";
import type { Database } from "../db/database.js";
import { getJsonObject, listAllKeys } from "./s3.js";
import { registerArchive } from "./register.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger({ module: "archive-reconcile" });

const MANIFEST_SUFFIX = ".result.json";

export interface ReconcileResult {
  manifests: number;
  registered: number;
  skipped: number;
  unattributed: number;
}

/**
 * タスク id は manifest の鍵を `_` で区切った最初の部分 (BrowserHive は名前を
 * `{taskId}_{correlationId}[_{labels}].{ext}` として組む) なので、オブジェクトを
 * 取りに行かずに読める。おかげで最も多い場合 —— 既に台帳に在る manifest ——
 * の GET が 0 回で済む。
 *
 * ここが `_` で切れるのは taskId が UUID だから。BrowserHive は correlationId と
 * labels を `%XX` へ逃がして組むが、**taskId だけは逃がさない** —— 逃がす対象の
 * 文字を含まないので、逃がしても逃がさなくても同じ綴りになる。将来 taskId の形が
 * UUID でなくなったら、この 1 行が最初に壊れる。
 */
const taskIdFromKey = (key: string): string =>
  key.slice(0, -MANIFEST_SUFFIX.length).split("_")[0] ?? "";

export const reconcile = async (
  db: Kysely<Database>,
  s3: S3Client,
  bucket: string,
): Promise<ReconcileResult> => {
  const keys = await listAllKeys(s3, bucket);
  const manifests = keys.filter((key) => key.endsWith(MANIFEST_SUFFIX));

  // manifest ごとに 1 回ではなく、まとめて 1 回のクエリ。
  const knownRows = await db.selectFrom("archives").select("taskId").execute();
  const known = new Set(knownRows.map((row) => row.taskId));

  const result: ReconcileResult = {
    manifests: manifests.length,
    registered: 0,
    skipped: 0,
    unattributed: 0,
  };

  for (const key of manifests) {
    const taskId = taskIdFromKey(key);
    if (taskId === "" || known.has(taskId)) {
      result.skipped += 1;
      continue;
    }

    // これがどの組織のためのものだったかは manifest に無い —— BrowserHive に
    // そういう概念が無いので。`capture_submissions` は waggle がジョブを投げた
    // ときに書いた記録で、それが無ければアーカイブの帰属は言えない。推測するのは
    // 空けておくより悪い。
    const submission = await db
      .selectFrom("captureSubmissions")
      .select(["orgId", "submittedBy"])
      .where("taskId", "=", taskId)
      .executeTakeFirst();
    if (!submission) {
      result.unattributed += 1;
      log.warn(
        { taskId, key },
        "Manifest has no matching submission; cannot attribute it to an organization",
      );
      continue;
    }

    const raw = await getJsonObject<unknown>(s3, bucket, key);
    if (raw === undefined) {
      // さっき listing に在ったものが、もう無い。書き留める以外にできることは無い。
      log.warn({ key }, "Manifest disappeared between listing and read");
      result.skipped += 1;
      continue;
    }

    // 冪等: polling 側との競合は unique index が吸収する。
    // identity はここでは作らない。reconcile は掃除役で、いま動かしている人と
    // 取り込みを頼んだ人は別 —— 投げた時点の記録から読む。`org_id` が既に
    // 取っているのと同じ形。
    const registered = await registerArchive(
      db,
      readManifest(raw),
      submission.orgId,
      submission.submittedBy,
    );
    if (registered.archiveId !== undefined) result.registered += 1;
    else result.skipped += 1;
  }

  log.info(result, "Reconcile complete");
  return result;
};
