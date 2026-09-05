/**
 * 投げた取り込みが終わるのを待ち、それがどうなったかを報告する。
 *
 * `SubmitCapture` は投げっぱなしなので、結果は後から集めるほかない。待っている間に
 * 引くのは `GetCaptureProgress` で、タスクごとにこう答える:
 *
 *   PENDING     —— まだ queue の中。`queuePosition` が前から何番目かを言う
 *   PROCESSING  —— worker が走らせている (再試行も含む)。
 *                  `worstCaseRemainingMs` が「最悪あとどれだけ待つか」を言う
 *   DONE        —— 終わった。結果は `GetCapture` から取る
 *   NOT_FOUND (エラー) —— 知らない、**または** 有界の結果キャッシュから溢れた
 *
 * **締切はこちらで決めない。** かつてここには `DEFAULT_TIMEOUT_MS = 10 分` があった。
 * 根拠は書かれておらず、server 側の予算 (試行 1 回 130 秒 × 3 回 ≒ 391 秒) とも
 * 無関係だった。いまは server が `worstCaseRemainingMs` で宣言する —— 見積もりでは
 * なく server が自分に課している上限なので、それを超えても DONE が来ないなら
 * 「遅い取り込み」ではなく server の異常。
 *
 * PENDING には付かない。順番待ちの長さは他人の仕事の量で決まり、server は上限を
 * 課していないため。そちらは時間で切るしかないが、切るときに理由を添える ——
 * 「混んでいる」と「誰も取りに来ない」は、ここからは同じに見える。
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
import { getCapture, getCaptureProgress, getServerStatus, isStatus } from "../rpc/calls.js";
import {
  CaptureState,
  type CaptureResultReport,
  type GetCaptureProgressResponse,
} from "../rpc/generated/browserhive/v1/capture.js";
import type { S3Client } from "@aws-sdk/client-s3";
import { getJsonObject } from "./s3.js";
import { readManifest } from "./manifest.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger({ module: "capture-watch" });

export interface WatchOptions {
  s3: S3Client;
  bucket: string;
  pollIntervalMs?: number;
  /**
   * 上限を運用側から被せる。**既定は無い** —— server が宣言する予算で待つ。
   *
   * 予算とは別の関心事で、「1 件の取り込みが実行全体を止めない」ためのもの。
   * 指定されていれば server の宣言より優先する。
   */
  timeoutMs?: number;
  /** PENDING のまま動かないときに諦めるまで。既定 {@link PENDING_PATIENCE_MS}。 */
  pendingPatienceMs?: number;
  /** server の宣言をどれだけ超えたら異常とみなすか。既定 {@link OVERRUN_GRACE_MS}。 */
  overrunGraceMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 2_000;

/**
 * server が宣言した上限を、どれだけ超えたら異常とみなすか。
 *
 * 詰めすぎてはいけない: `taskTotalMs` が掛かるのは取り込み処理の部分で、dequeue から
 * アップロードまでの全体ではない。実測で試行 1 回あたり 300ms 弱を超過する。
 * 逆に大きすぎても、失うのは気づくまでの時間だけ —— 取りこぼしにはならない。
 *
 * `pollIntervalMs` と同じく `WatchOptions` から差し替えられる。CLI には出さない ——
 * 運用者が触るものではなく、呼ぶ側 (とテスト) のための継ぎ目。
 */
const OVERRUN_GRACE_MS = 30_000;

/**
 * PENDING のまま動かないときに諦めるまで。
 *
 * **これは予算ではない。** 順番待ちに server は上限を課していないので、ここは
 * 「終わらない取り込みが実行全体を止めない」ためだけの数字。
 */
const PENDING_PATIENCE_MS = 10 * 60 * 1_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * manifest は成果物の隣に、BrowserHive のファイル名規則で置かれる:
 * `{taskId}_{correlationId}[_{labels}].result.json`。
 *
 * **correlationId の枠は空でも出る** (`{taskId}__{labels}` のように下線が並ぶ)。
 * それが BrowserHive 側で名前を読み戻せるようにしている仕掛けで、こちらも
 * 合わせないと存在しない鍵を作ることになる。値の中の `_` `.` `/` 空白などは
 * `%XX` へ逃がす —— 逃がさないと区切りと衝突して、鍵が 1 文字ずれる。
 *
 * waggle が、server から渡された鍵を読むのではなく自分で組み立てる唯一の場所。
 * **間違えても静かに壊れる** —— 失うのはこの代替経路だけで、reconciler のほうは
 * listing でオブジェクトを見つけてしまうので、ログにも結果にも出ない。
 * だから test/manifest-key.test.ts は BrowserHive と同じケースを並べてある。
 *
 * 本体は browserhive の src/capture/artifact-name.ts (generateFilename)。
 */
const ESCAPED = /[%_.<>:"/\\|?*\s]/g;

/** 逃がすのは 1 回の走査で。順に replace を重ねると二重符号化する。 */
const encodeField = (value: string): string =>
  value.replace(ESCAPED, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);

export const manifestKey = (
  taskId: string,
  correlationId: string | undefined,
  labels: string[],
): string =>
  [taskId, encodeField(correlationId ?? ""), ...labels.map(encodeField)].join("_") + ".result.json";

const readManifestFallback = async (
  taskId: string,
  correlationId: string | undefined,
  labels: string[],
  options: WatchOptions,
): Promise<CaptureResultReport | undefined> => {
  const key = manifestKey(taskId, correlationId, labels);
  const raw = await getJsonObject(options.s3, options.bucket, key);
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
  const pendingPatienceMs = options.pendingPatienceMs ?? PENDING_PATIENCE_MS;
  const overrunGraceMs = options.overrunGraceMs ?? OVERRUN_GRACE_MS;
  const startedWaiting = Date.now();
  // 運用側から被せる上限。既定は無く、その場合は server の宣言で待つ。
  const hardDeadline =
    options.timeoutMs === undefined ? undefined : startedWaiting + options.timeoutMs;

  for (;;) {
    let progress: GetCaptureProgressResponse;
    try {
      progress = await getCaptureProgress({ taskId });
    } catch (caught) {
      if (!isStatus(caught, status.NOT_FOUND)) throw caught;
      // 知らないタスクか、結果が押し出されたか。ここからは見分けが付かないので、
      // 永続化された複製に訊く。
      return readManifestFallback(taskId, correlationId, labels, options);
    }

    if (progress.state === CaptureState.CAPTURE_STATE_DONE) {
      return collectReport(taskId, correlationId, labels, options);
    }

    if (hardDeadline !== undefined && Date.now() > hardDeadline) {
      log.warn(
        { taskId, timeoutMs: options.timeoutMs },
        "capture still running past the configured timeout; leaving it to reconcile",
      );
      return undefined;
    }

    const remainingMs = progress.progress?.worstCaseRemainingMs;
    if (remainingMs === undefined) {
      // PENDING —— server は順番待ちに上限を課していない。時間で切るしかないが、
      // 切るときに理由を添える。「混んでいる」と「誰も取りに来ない」は別の話で、
      // 後者は待っても解決しない。
      if (Date.now() > startedWaiting + pendingPatienceMs) {
        log.warn(
          {
            taskId,
            queuePosition: progress.progress?.queuePosition,
            ...(await describeWhyNothingMoves()),
          },
          "capture is still pending; leaving it to reconcile",
        );
        return undefined;
      }
    } else if (Date.now() > startedWaiting + remainingMs + overrunGraceMs) {
      // server が自分の宣言を超えた。取り込みが遅いのではなく server 側の異常。
      log.warn(
        { taskId, declaredRemainingMs: remainingMs, retryCount: progress.progress?.retryCount },
        "server overran its own declared budget; leaving it to reconcile",
      );
      return undefined;
    }

    await sleep(pollIntervalMs);
  }
};

/**
 * DONE と分かってから、結果を 1 度だけ取る。
 *
 * `GetCaptureProgress` は結果を運ばない (それが役割の分かれ目) ので、ここで
 * `GetCapture` に訊く。**この呼び出しも NOT_FOUND になりうる** —— DONE を見てから
 * 訊くまでの間に、有界の結果キャッシュから押し出されることがある。拾い忘れると、
 * まさに調べる価値のある取り込みだけが例外で落ちる。
 */
const collectReport = async (
  taskId: string,
  correlationId: string | undefined,
  labels: string[],
  options: WatchOptions,
): Promise<CaptureResultReport | undefined> => {
  let report: CaptureResultReport | undefined;
  try {
    ({ report } = await getCapture({ taskId }));
  } catch (caught) {
    if (!isStatus(caught, status.NOT_FOUND)) throw caught;
    return readManifestFallback(taskId, correlationId, labels, options);
  }

  // report の無い DONE は、server が自分と矛盾したということ。空の report を
  // 返すと後から「失敗した取り込み」として読まれるので、同じ「答えが無い」
  // 扱いにする。
  if (report !== undefined) return report;
  log.warn({ taskId }, "capture reported DONE with no report; falling back to the manifest");
  return readManifestFallback(taskId, correlationId, labels, options);
};

/**
 * なぜ動かないのかを訊く。**PENDING を諦める瞬間にしか呼ばない。**
 *
 * `GetServerStatus` は全 worker とキュー全体を返すので、待っている間ずっと引くと
 * 待ち client 数 × キューの長さでコストが効く。ここは 1 回きり。
 *
 * これ自体が失敗しても、報告そのものは出す —— 理由が付かないログのほうが、
 * ログが出ないことよりずっとよい。
 */
const describeWhyNothingMoves = async (): Promise<Record<string, unknown>> => {
  try {
    const serverStatus = await getServerStatus();
    return {
      operationalWorkers: serverStatus.operationalWorkers,
      totalWorkers: serverStatus.totalWorkers,
      isDegraded: serverStatus.isDegraded,
      queueDepth: serverStatus.pending,
    };
  } catch (caught) {
    return { serverStatusError: String(caught) };
  }
};
