/**
 * 終わった取り込みを台帳に入れ、それを到達可能にする tuple を queue に積む ——
 * 1 つのトランザクションで。
 *
 * この 2 つの書き込みは、それだけでは 1 つの原子的な操作にできない: アーカイブの
 * 行は Postgres へ、関係の tuple は OpenFGA の HTTP API へ行き、両方に跨がる
 * トランザクションは無い。独立にやると片方だけ入りうるし、その両側とも悪い ——
 * 誰も辿り着けないアーカイブか、巻き戻された行を指す権限か。
 *
 * そこで tuple の書き込みは、アーカイブと同じトランザクションの中で outbox の
 * 行として **記録** する。両方入るか、どちらも入らないか。あとは worker が
 * OpenFGA に受け入れられるまで再送しながら配送する。
 */
import type { Kysely } from "kysely";
import {
  CaptureStatus,
  captureStatusToJSON,
  type CaptureResultReport,
} from "../rpc/generated/browserhive/v1/capture.js";
import type { Database } from "../db/database.js";
import { parseS3Uri } from "./s3-uri.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger({ module: "archive-register" });

export interface RegisterResult {
  /** 何も挿入しなかったときは `undefined` —— エラーではない。下を見ること。 */
  archiveId?: string;
  reason?: "no-archive" | "already-known";
}

export const registerArchive = async (
  db: Kysely<Database>,
  report: CaptureResultReport,
  orgId: string,
): Promise<RegisterResult> => {
  // 失敗した取り込みは何もアップロードしていない。それを記録すると、署名の
  // エンドポイントが存在しないオブジェクトの URL を配ることになる —— 404 に対して
  // 認可が完璧に働いている状態で、最も気づきにくい壊れ方。
  // 比べる相手は必ず enum で、文字列ではない。report はいま protobuf —— wire でも
  // `.result.json` の manifest でも同じ —— なので `status` は数値であり、
  // `report.status !== "success"` はコンパイルは通ったうえで、これまでのすべての
  // 取り込みについて真になっていた。
  if (
    report.status !== CaptureStatus.CAPTURE_STATUS_SUCCESS ||
    report.artifacts?.wacz === undefined
  ) {
    log.warn(
      {
        taskId: report.taskId,
        status: captureStatusToJSON(report.status),
        error: report.errorDetails?.message,
        url: report.url,
      },
      "capture produced no archive; not adding to the ledger",
    );
    return { reason: "no-archive" };
  }

  // ファイル名を組み直したものではなく、server 自身の報告から取る。
  const { bucket, key } = parseS3Uri(report.artifacts.wacz);

  return db.transaction().execute(async (trx) => {
    const inserted = await trx
      .insertInto("archives")
      .values({
        taskId: report.taskId,
        correlationId: report.correlationId ?? null,
        bucket,
        objectKey: key,
        sourceUrl: report.url,
        labels: report.labels,
        waczComplete: report.completeness?.complete ?? null,
        capturedAt: report.timestamp,
      })
      // poller と reconciler の両方が同じ取り込みに辿り着けるし、どちらも
      // 再実行されうる。unique index があるので、それは重複ではなく無操作になる。
      .onConflict((oc) => oc.columns(["bucket", "objectKey"]).doNothing())
      .returning("id")
      .executeTakeFirst();

    // 既に台帳に在るということは、tuple も最初のときに queue へ積まれている。
    // もう一度書いても害は無いが、意味も無い。
    if (!inserted) return { reason: "already-known" as const };

    await trx
      .insertInto("fgaOutbox")
      .values({
        payload: JSON.stringify({
          writes: [
            {
              user: `capture_job:${report.taskId}`,
              relation: "parent",
              object: `archive:${inserted.id}`,
            },
            {
              user: `organization:${orgId}`,
              relation: "parent",
              object: `capture_job:${report.taskId}`,
            },
          ],
        }),
      })
      .execute();

    log.info(
      { archiveId: inserted.id, taskId: report.taskId, orgId, objectKey: key },
      "archive registered",
    );
    return { archiveId: inserted.id };
  });
};
