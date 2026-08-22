/**
 * 印に対する回帰テスト: cast だけで送信の経路に到達できてはならない。
 *
 * ここには実行時に検査されるものが 1 つも無い —— 主張は型の上に在り、検査するのは
 * tsc。`@ts-expect-error` は「この行はコンパイルに失敗しなければならない」という
 * 主張なので、守りが効かなくなった瞬間に、それ自体がエラーへ反転する。防御が
 * 解けたことを、解けたその瞬間に報告してくれるのはこの性質だけ。
 *
 * したがってこのファイルに意味があるのは、CI で `npm run typecheck` が走るから。
 * vitest も eslint も `@ts-expect-error` を見ていない。
 */
import { describe, expect, it } from "vitest";
import { submitCapture } from "../src/rpc/calls.js";
import { sealWire, type WireSubmitCapture } from "../src/rpc/wire.js";
import {
  CacheMode,
  type SubmitCaptureRequest,
} from "../src/rpc/generated/browserhive/v1/capture.js";

/** 印の付いたリクエストしか受け取らない、本物の送信経路の代役。 */
const send = (request: WireSubmitCapture): string => request.url;

const valid: SubmitCaptureRequest = {
  url: "https://example.com/",
  labels: [],
  cache: CacheMode.CACHE_MODE_UNSPECIFIED,
  devicePixelRatios: [],
};

/**
 * 代役ではなく、本物の送信経路。
 *
 * 下の stub は便利だが、それ自体は何も証明しない: `submitCapture` の型が
 * `SubmitCaptureRequest` に戻されたら、実際の関門は消えているのに stub は通り
 * 続ける。印の付いた型は元の型に代入できるので、他のどこも赤くならない。この 1 行が、
 * テストと守っている対象を結んでいる。
 */
// @ts-expect-error submitCapture accepts only a sealed request
const gatesTheRealSendPath: Parameters<typeof submitCapture>[0] = valid;
void gatesTheRealSendPath;

describe("wire brand", () => {
  it("accepts a request that went through sealWire", () => {
    expect(send(sealWire(valid))).toBe("https://example.com/");
  });

  it("rejects one that merely has the right shape", () => {
    // @ts-expect-error an unsealed SubmitCaptureRequest is not a WireSubmitCapture
    expect(() => send(valid)).not.toThrow();
  });

  it("rejects a two-step cast", () => {
    const plain: Record<string, unknown> = { url: "https://example.com/" };
    // BrowserHive の e2e を壊したのと同じ書き方。cast は型検査を通り抜ける。
    // 偽造できないのが印のほう。
    // @ts-expect-error a two-step cast cannot satisfy WireSubmitCapture
    expect(() => send(plain as unknown as SubmitCaptureRequest)).not.toThrow();
  });
});
