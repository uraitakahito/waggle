/**
 * 台帳の穴を、bucket に永続化された結果 manifest から埋める。
 *
 * 取り込みの結果を待つ polling は、flow が動いている間しか働かない。落ちていた、
 * 再起動した、
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
 * S3 の list は prefix でしか絞れない —— **拡張子での絞り込みも「いつ以降」も無い。**
 * だから listing を引いてから manifest をここで選ぶ。今の規模 (数十オブジェクト) なら
 * 全部歩いても数百 ms で、既定はいまも全走査。
 *
 * 絞れる手がかりは在る。受け口が受けた成果物の鍵は ledger が決めるので
 * `org/<orgId>/<YYYY-MM>/` の下に在り (`api/sink.ts` の `crawlKeyPrefix`)、その接頭辞は
 * `crawls.artifact_key_prefix` に書き残してある (`013`)。`prefixes` を渡せば、その月
 * だけを歩く。**BrowserHive が自前の保管庫へ書く経路は平らなまま**なので、そちらは
 * 絞れない —— だから絞るのは明示のときだけで、既定を変えていない。
 */
import type { Kysely } from "kysely";
import type { S3Client } from "@aws-sdk/client-s3";
import { readManifest } from "./manifest.js";
import type { Database } from "../db/database.js";
import { getJsonObject, listAllKeys } from "./s3.js";
import { admitArchive } from "./admit.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger({ module: "archive-reconcile" });

const MANIFEST_SUFFIX = ".result.json";

/**
 * `archives.task_id` も `capture_submissions.task_id` も **uuid 列**。UUID でない値で
 * 引くと Postgres が `invalid input syntax for type uuid` で落ち、**その 1 件で走行が
 * 丸ごと止まる** —— 残りの manifest は歩かれないまま終わる。
 *
 * 鍵の綴りは BrowserHive が決めるが、bucket に何が置かれるかは決めない。他所が置いた
 * ものや、手で入れたもの、古い綴りの残りが混じりうる。**bucket は信用しない。**
 *
 * `api/sink.ts` が `crawlId` に対して同じ守りをしている (実地で 500 を踏んだ後に入れた)。
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
 *
 * **export しているのは試験のため。** 非公開のままだったので prefix を入れたときに
 * 誰も気づかず、`reconcile` を走らせるまで壊れが表に出なかった。
 */
export const taskIdFromKey = (key: string): string => {
  // **prefix を先に落とす。** 受け口が受けた成果物は `org/<orgId>/…` に在るので、
  // 鍵をそのまま `_` で切ると `org/acme/<taskId>` が返る。それは uuid ではないので、
  // `archives` や `capture_submissions` を引いた瞬間に Postgres が
  // `invalid input syntax for type uuid` で落ちる —— **prefix を入れた日に壊れていた。**
  //
  // `/` が無ければ `lastIndexOf` は -1 を返し、`slice(0)` が全体になる。平らな配置
  // (BrowserHive が自前の保管庫へ書く従来の経路) はそのまま通る。
  const filename = key.slice(key.lastIndexOf("/") + 1);
  return filename.slice(0, -MANIFEST_SUFFIX.length).split("_")[0] ?? "";
};

/**
 * 窓に入ったクロールの行から、歩くべき接頭辞を決める。`undefined` は「全部歩く」。
 *
 * **1 本でも記録の無い行があれば絞らない。** その行の成果物がどこに在るかを言えない
 * のに絞れば、その穴は二度と見つからない —— 冒頭に書いたとおり、気づかれない穴の
 * ある台帳は台帳が無いより悪い。**取りこぼしを速さと交換しない。**
 *
 * DB を触らない純関数にしてあるのは、この判断こそ検査したいから。ledger には DB に
 * 繋ぐ試験が 1 本も無いので、判断をクエリと同じ関数に置くと誰も確かめられなくなる。
 */
export const narrowingFrom = (
  rows: readonly { artifactKeyPrefix: string | null }[],
): string[] | undefined => {
  const prefixes: string[] = [];
  for (const row of rows) {
    if (row.artifactKeyPrefix === null) return undefined;
    prefixes.push(row.artifactKeyPrefix);
  }
  return [...new Set(prefixes)];
};

export const reconcile = async (
  db: Kysely<Database>,
  s3: S3Client,
  bucket: string,
  /** 歩く接頭辞。省くと bucket 全体。`narrowingFrom` が決める。 */
  prefixes?: readonly string[],
): Promise<ReconcileResult> => {
  // 接頭辞をまたいで同じ鍵が返ることは無いが、`Set` で受けるのは接頭辞どうしが
  // 入れ子になった場合の保険 (`org/a/` と `org/a/2026-09/` を両方渡せてしまう)。
  const keys =
    prefixes === undefined
      ? await listAllKeys(s3, bucket)
      : [
          ...new Set(
            (await Promise.all(prefixes.map((prefix) => listAllKeys(s3, bucket, prefix)))).flat(),
          ),
        ];
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
    if (!UUID.test(taskId) || known.has(taskId)) {
      // 形が違うものは飛ばす。**止めない** —— 1 件の見慣れない鍵で掃除が終わって
      // しまうと、その先に在る本物の穴が埋まらない。
      result.skipped += 1;
      continue;
    }

    // これがどの組織のためのものだったかは manifest に無い —— BrowserHive に
    // そういう概念が無いので。`capture_submissions` は ledger がジョブを投げた
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

    const raw = await getJsonObject(s3, bucket, key);
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
    const registered = await admitArchive(
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
