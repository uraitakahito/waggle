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
