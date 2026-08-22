/**
 * 投げた取り込みが終わるのを待ち、それがどうなったかを報告する。
 *
 * `SubmitCapture` は投げっぱなしなので、結果は後から集めるほかない。`GetCapture` は
 * タスクごとにこう答える:
 *
 *   PENDING / PROCESSING —— まだ queue の中か実行中。再試行も含む
 *   DONE                 —— 終わった。成果物が在るかは `report.status` が言う
 *   NOT_FOUND (エラー)    —— 知らない、**または** 有界の結果キャッシュから溢れた
 *
 * この NOT_FOUND が、これを 2 行のループにできない理由。結果は新しいものが
 * `--result-cache-size` 件 (既定 1000) 積まれると押し出され、BrowserHive の再起動も
 * 越えない。長く待つと、答えのほうが消えていることがある。同じ本文は bucket に
 * `.result.json` として永続化されているので、そこへ落ちる —— それすら無ければ、
 * manifest の reconciler が後から listing で拾う。黙って捨てられるものは無い。
 *
 * NOT_FOUND 以外 —— 届かない server、壊れた channel —— はそのまま伝播させる。
 * それらは「この取り込みが見つからない」ではないし、ここで飲み込むと、障害が
 * 「静かに何もアーカイブしない実行」に化ける。
 */
import { status } from "@grpc/grpc-js";
import { getCapture, isStatus } from "../rpc/calls.js";
import { CaptureState, type CaptureResultReport } from "../rpc/generated/browserhive/v1/capture.js";
import type { S3Client } from "@aws-sdk/client-s3";
import { getJsonObject } from "./s3.js";
import { readManifest } from "./manifest.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger({ module: "capture-watch" });

export interface WatchOptions {
  s3: S3Client;
  bucket: string;
  pollIntervalMs?: number;
  /** これだけ経ったら諦める。終わらない取り込みが実行全体を止めてはならない。 */
  timeoutMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * manifest は成果物の隣に、BrowserHive のファイル名規則で置かれる:
 * `{taskId}[_{correlationId}][_{labels}].result.json`。label は `-` で繋ぐ。
 *
 * waggle が、server から渡された鍵を読むのではなく自分で組み立てる唯一の場所。
 * 間違えても致命的ではない —— 失うのはこの代替経路だけで、reconciler のほうは
 * listing でオブジェクトを見つける。
 */
export const manifestKey = (
  taskId: string,
  correlationId: string | undefined,
  labels: string[],
): string => {
  const parts = [taskId];
  if (correlationId !== undefined && correlationId !== "") parts.push(correlationId);
  if (labels.length > 0) parts.push(labels.join("-"));
  return `${parts.join("_")}.result.json`;
};

const readManifestFallback = async (
  taskId: string,
  correlationId: string | undefined,
  labels: string[],
  options: WatchOptions,
): Promise<CaptureResultReport | undefined> => {
  const key = manifestKey(taskId, correlationId, labels);
  const raw = await getJsonObject<unknown>(options.s3, options.bucket, key);
  if (raw !== undefined) {
    log.debug({ taskId, key }, "result was evicted from the cache; read the manifest");
    return readManifest(raw);
  }
  log.warn({ taskId, key }, "no cached result and no manifest; leaving it to reconcile");
  return undefined;
};

export const waitForCapture = async (
  taskId: string,
  correlationId: string | undefined,
  labels: string[],
  options: WatchOptions,
): Promise<CaptureResultReport | undefined> => {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  for (;;) {
    let state: CaptureState;
    let report: CaptureResultReport | undefined;
    try {
      ({ state, report } = await getCapture({ taskId }));
    } catch (caught) {
      if (!isStatus(caught, status.NOT_FOUND)) throw caught;
      // 知らないタスクか、結果が押し出されたか。ここからは見分けが付かないので、
      // 永続化された複製に訊く。
      return readManifestFallback(taskId, correlationId, labels, options);
    }

    // report の無い DONE は、server が自分と矛盾したということ。空の report を
    // 返すと後から「失敗した取り込み」として読まれるので、同じ「答えが無い」
    // 扱いにする。
    if (state === CaptureState.CAPTURE_STATE_DONE) {
      if (report !== undefined) return report;
      log.warn({ taskId }, "capture reported DONE with no report; falling back to the manifest");
      return readManifestFallback(taskId, correlationId, labels, options);
    }

    if (Date.now() > deadline) {
      log.warn({ taskId }, "capture still running past the deadline; leaving it to reconcile");
      return undefined;
    }
    await sleep(pollIntervalMs);
  }
};
