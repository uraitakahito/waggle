import type { Kysely } from "kysely";
import { getCaptureSettings, logClientConfig, type ClientOptions } from "../config/cli-options.js";
import { storageConfig } from "../config/env.js";
import { loadUrls, type DataEntry } from "../data/url-source.js";
import { createPool } from "../db/pool.js";
import { createKyselyClient } from "../db/kysely.js";
import type { Database } from "../db/database.js";
import { createS3Client } from "../archive/s3.js";
import { waitForCapture } from "../archive/watch.js";
import { registerArchive } from "../archive/register.js";
import { logger } from "../logger.js";
import type { CaptureSettings } from "../types/capture.js";
import { closeClient, configureClient } from "../rpc/client.js";
import { submitRequest, type SubmitResult } from "./submit.js";

/**
 * 全エントリを並列に投げ、結果が届いた順にログへ出す。
 * すべての投稿が決着したら返る。
 */
export const submitAll = async (
  entries: DataEntry[],
  settings: CaptureSettings,
): Promise<SubmitResult[]> => {
  const total = entries.length;
  let completed = 0;

  const promises = entries.map(async (entry) => {
    const result = await submitRequest(entry, settings);
    completed++;

    if (result.accepted) {
      logger.info(
        {
          progress: `${String(completed)}/${String(total)}`,
          taskId: result.taskId,
          correlationId: result.correlationId,
          labels: result.labels,
        },
        "Request accepted",
      );
    } else {
      logger.warn(
        {
          progress: `${String(completed)}/${String(total)}`,
          taskId: result.taskId,
          correlationId: result.correlationId,
          labels: result.labels,
          error: result.error ?? "Unknown error",
        },
        "Request rejected",
      );
    }

    return result;
  });

  return Promise.all(promises);
};

const logSummary = (results: SubmitResult[], totalDuration: number): void => {
  const acceptedCount = results.filter((r) => r.accepted).length;
  const rejectedCount = results.filter((r) => !r.accepted).length;

  logger.info(
    {
      total: results.length,
      accepted: acceptedCount,
      rejected: rejectedCount,
      durationMs: totalDuration,
    },
    "Request summary",
  );
};

/**
 * 受理された各タスクが、どの組織のものかを記録する。
 *
 * 取り込みを待ち始める前に書く。それを知っているのがここだけだから。BrowserHive に
 * 組織という概念は無く、後から manifest から復元した結果は組織を特定するものを
 * 何も運ばない —— この行が無いと、reconciler はアーカイブの帰属を言えない。
 */
const recordSubmissions = async (db: Kysely<Database>, results: SubmitResult[]): Promise<void> => {
  const accepted = results.filter((r) => r.accepted);
  if (accepted.length === 0) return;

  await db
    .insertInto("captureSubmissions")
    .values(
      accepted.map((r) => ({
        taskId: r.taskId,
        correlationId: r.correlationId,
        orgId: r.orgId,
        submittedBy: null,
        sourceUrl: r.sourceUrl,
      })),
    )
    // taskId が再投稿されることは無い (server が生成するので) が、この関数自体が
    // 再実行されることはある。
    .onConflict((oc) => oc.column("taskId").doNothing())
    .execute();
};

/**
 * 受理された全タスクを待ち、アーカイブを生んだものを台帳に足す。
 *
 * ここでの失敗は意図して実行全体の致命傷にしない: 報告が来ない取り込みも、競合に
 * 負けた台帳への書き込みも、後から `waggle fga:reconcile` が永続化された manifest
 * から拾う。この段の目的は待ち時間であって正しさではない —— 正しさは reconciler の
 * 仕事。
 */
const collectResults = async (
  db: Kysely<Database>,
  results: SubmitResult[],
  options: ClientOptions,
): Promise<void> => {
  const storage = storageConfig();
  const s3 = createS3Client(storage);
  const accepted = results.filter((r) => r.accepted);

  for (const result of accepted) {
    try {
      const report = await waitForCapture(result.taskId, result.correlationId, result.labels, {
        s3,
        bucket: storage.bucket,
        ...(options.captureTimeoutMs !== undefined && { timeoutMs: options.captureTimeoutMs }),
      });
      if (!report) continue;
      await registerArchive(db, report, result.orgId);
    } catch (caught) {
      logger.warn(
        { err: caught, taskId: result.taskId },
        "Could not collect this capture; reconcile will retry",
      );
    }
  }
};

/**
 * 最上位の段取り: Postgres から URL を読み、client を設定し、全エントリを投げ、
 * まとめをログに出す。
 */
export const runClient = async (options: ClientOptions): Promise<void> => {
  const startTime = Date.now();

  logClientConfig(options);
  configureClient(options.server, options.tlsCaCert);

  // gRPC の channel は、置き換えた fetch の client と違って、それ自体が event loop を
  // 生かし続ける。これが無いとプロセスは仕事を終えたあとぶら下がったままになる。
  try {
    const pool = createPool(options.databaseUrl);
    let entries: DataEntry[];
    try {
      entries = await loadUrls(pool, {
        ...(options.limit !== undefined && { limit: options.limit }),
      });
    } finally {
      await pool.end();
    }

    logger.info({ count: entries.length }, "Loaded entries from database");

    if (entries.length === 0) {
      logger.info("No entries to process");
      return;
    }

    const results = await submitAll(entries, getCaptureSettings(options));

    const db = createKyselyClient(options.databaseUrl);
    try {
      await recordSubmissions(db, results);
      if (options.collect !== false) {
        await collectResults(db, results, options);
      }
    } finally {
      await db.destroy();
    }

    const totalDuration = Date.now() - startTime;
    logSummary(results, totalDuration);
  } finally {
    closeClient();
  }
};
