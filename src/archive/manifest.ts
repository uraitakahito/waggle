/**
 * BrowserHive の `.result.json` manifest を読む。
 *
 * manifest は取り込み結果の永続化された複製で、成果物の隣に書かれる。BrowserHive
 * v3 以降これは **protobuf JSON**: server は `GetCapture` に答えるのと同じ
 * `CaptureResultReport` メッセージを、生成された `toJSON` を通して直列化している。
 *
 * つまり enum は protobuf の名前で綴られる —— `status` は `"success"` ではなく
 * `"CAPTURE_STATUS_SUCCESS"` —— し、ここで誰も手でオブジェクトを解析していないのは
 * そのため。`fromJSON` は書き手の生成された逆関数なので、復号した report は wire から
 * 戻ってきたものと形が同一になり、呼ぶ側は 2 つの経路のどちらで届いたかを気にせず
 * `CaptureStatus` の enum と比べられる。
 */
import { CaptureResultReport } from "../rpc/generated/browserhive/v1/capture.js";

export const readManifest = (raw: unknown): CaptureResultReport =>
  CaptureResultReport.fromJSON(raw);

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
 * `\p{Cc}` (制御文字) を逃がすのは、鍵が ListObjectsV2 の **XML** で返るため。
 * XML 1.0 は ASCII 0-8 などを表せないので、残すと「オブジェクトは在るのに
 * 一覧に出てこない」になる。`\s` は CR/LF/TAB しか覆わない。
 *
 * 本体は browserhive の src/capture/artifact-name.ts (generateFilename)。
 */
const ESCAPED = /[%_.<>:"/\\|?*\s\p{Cc}]/gu;

/** 逃がすのは 1 回の走査で。順に replace を重ねると二重符号化する。 */
const encodeField = (value: string): string =>
  value.replace(ESCAPED, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);

export const manifestKey = (
  taskId: string,
  correlationId: string | undefined,
  labels: string[],
  /**
   * 置き場所の接頭辞。**受け口が成果物を受け取る構成でだけ付く。**
   *
   * BrowserHive が自前の保管庫へ書くときは平らな名前空間なので空。受け口が受けると
   * 組織で分ける (`org/<orgId>/`) ので、鍵の綴りもそれに従う —— ここがずれると
   * **manifest が見つからず、台帳に 1 行も入らないまま静かに終わる。**
   */
  keyPrefix = "",
): string =>
  keyPrefix +
  [taskId, encodeField(correlationId ?? ""), ...labels.map(encodeField)].join("_") +
  ".result.json";
