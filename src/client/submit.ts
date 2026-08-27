import { randomUUID } from "node:crypto";
import { submitCapture } from "../rpc/calls.js";
import { CacheMode, type Behavior } from "../rpc/generated/browserhive/v1/capture.js";
import { sealWire, type WireSubmitCapture } from "../rpc/wire.js";
import type { DataEntry } from "../data/url-source.js";
import type { CaptureSettings } from "../types/capture.js";

export interface SubmitResult {
  taskId: string;
  correlationId: string;
  labels: string[];
  /** エントリからそのまま返す。呼ぶ側がタスクの帰属を言えるようにするため。 */
  orgId: string;
  sourceUrl: string;
  accepted: boolean;
  error?: string;
}

const generateCorrelationId = (): string => randomUUID().replace(/-/g, "").slice(0, 8);

/**
 * 呼び出しが何で reject したにせよ、そこから人が読める文字列を取り出す。
 *
 * `details` を先に見るのは、`ServiceError` が `Error` でもあり、その `message` が
 * status を detail に貼り付けたものだから —— `details` が単に `"url is empty"` の
 * ところ、`message` は `"3 INVALID_ARGUMENT: url is empty"` になる。status は
 * 隣のログ行が既に運んでいるので、この接頭辞は雑音。
 *
 * reject の値は `unknown` で、この関数の仕事は「実行にエラーメッセージが無い」の
 * 原因に決してならないこと。後ろの分岐は、channel が自前の何かを投げた場合を
 * 覆っている。
 */
const extractErrorMessage = (raw: unknown): string | undefined => {
  if (typeof raw === "object" && raw !== null) {
    const details = (raw as Record<string, unknown>)["details"];
    if (typeof details === "string" && details !== "") return details;
  }
  if (raw instanceof Error) return raw.message;
  if (typeof raw === "string") return raw;
  if (typeof raw === "object" && raw !== null) {
    const message = (raw as Record<string, unknown>)["message"];
    if (typeof message === "string") return message;
  }
  return undefined;
};

/**
 * wire に載せるリクエストを組み立てる。
 *
 * ここの 2 つの形は、選んだ結果ではなく proto3 の都合:
 *
 *   - `cache` は素の enum field なので、不在になれない。`*_UNSPECIFIED` (0) が
 *     「呼ぶ側は何も言わなかった」の綴りで、BrowserHive がそれを自分の既定値に
 *     戻す。
 *   - `devicePixelRatios` は `repeated` で、これも不在になれず、空のリストと
 *     省略を区別できない。だから `[]` が「呼ぶ側は何も言わなかった」の綴りで、
 *     BrowserHive は `--device-pixel-ratios` に落ちる。
 *
 * behavior は v4.0.0 でこの制約から抜けた。`behaviors.behaviors` は message で
 * 包まれていて presence を持つので、**空の `items` が「1 つも走らせない」を言える**。
 * それ以前は空のリストが「指定なし」に化け、`--behaviors ""` は黙って効いて
 * いなかった。
 */
/**
 * built-in の id 1 つを、wire の `Behavior` にする。
 *
 * 設定は載せない —— waggle が渡すのは「どれを走らせるか」だけで、値は
 * BrowserHive の既定に委ねている。設定まで指定したくなったら、ここに
 * その behavior の枝を組み立てる。
 *
 * 知らない id は `--behaviors` の argParser が既に弾いている。ここで既定へ
 * 落とすと、打ち間違いが「何も走らないまま成功」に化ける。
 */
const toWireBehavior = (id: string): Behavior => {
  switch (id) {
    case "autoscroll":
      return { autoscroll: {} };
    case "autofetch":
      return { autofetch: {} };
    case "autoplay":
      return { autoplay: {} };
    default:
      throw new Error(`unknown built-in behavior: ${id}`);
  }
};

const buildRequest = (
  entry: DataEntry,
  settings: CaptureSettings,
  correlationId: string,
): WireSubmitCapture => {
  const behaviors = settings.behaviors;
  return sealWire({
    url: entry.url,
    labels: entry.labels,
    correlationId,
    captureFormats: settings.captureFormats,
    dismissBannersEnabled: settings.dismissBanners,
    cache: CacheMode.CACHE_MODE_UNSPECIFIED,
    ...(settings.acceptLanguage !== undefined && { acceptLanguage: settings.acceptLanguage }),
    devicePixelRatios: settings.devicePixelRatios ?? [],
    ...(settings.operationDelayMs !== undefined && {
      operationDelayMs: settings.operationDelayMs,
    }),
    ...(behaviors !== undefined && {
      behaviors: {
        // `builtins` を書いたら、それが走るものの全部になる。書かなければ
        // `behaviors` の message ごと省き、BrowserHive の既定に委ねる。
        ...(behaviors.builtins !== undefined && {
          behaviors: { items: behaviors.builtins.map(toWireBehavior) },
        }),
        ...(behaviors.siteBehaviors !== undefined && { siteBehaviors: behaviors.siteBehaviors }),
      },
    }),
  });
};

/**
 * 取り込みのリクエストを 1 件 BrowserHive に送る。
 *
 * 投げっぱなし: 呼び出しが成功したということは、server が仕事を queue に入れて
 * `taskId` を返したということ。実際の取り込みは server 側で非同期に走り、結果は
 * 後から `waitForCapture` が集める。
 *
 * どんな失敗 —— 拒まれたリクエスト、届かない server —— も、返す `SubmitResult` の
 * `accepted: false` として表に出す。呼ぶ側がこの関数から例外を見ることはない。
 */
export const submitRequest = async (
  entry: DataEntry,
  settings: CaptureSettings,
): Promise<SubmitResult> => {
  const correlationId = generateCorrelationId();
  const base = {
    correlationId,
    labels: entry.labels,
    orgId: entry.orgId,
    sourceUrl: entry.url,
  };

  try {
    const response = await submitCapture(buildRequest(entry, settings, correlationId));
    // `response.accepted` は見ない。拒まれた投稿は non-OK の status で届くので、
    // ここに到達した時点で既に受理されている —— 逆にこの field を読むと、
    // proto3 の boolean は既定が false なので、設定し忘れた server が queue に
    // 入れたタスクを「拒否」として報告してしまう。
    return { ...base, taskId: response.taskId, accepted: true };
  } catch (caught) {
    return {
      ...base,
      taskId: "",
      accepted: false,
      error: extractErrorMessage(caught) ?? "Unknown error",
    };
  }
};
