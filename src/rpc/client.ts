/**
 * BrowserHive の gRPC client。
 *
 * channel はプロセスに 1 本で、`configureClient` が作り `closeClient` が畳む。
 * channel は本物のリソース —— keepalive のタイマーを持つ開いた HTTP/2 接続 ——
 * で、そこが置き換えた `fetch` ベースの client との主な違いになる:
 * **閉じ忘れた実行はプロセスが終わらない。** `runClient` は `finally` で閉じている。
 *
 * もう 1 つ知っておく価値のある違いは、`--tls-ca-cert` が実際に働くようになった
 * こと。`fetch` の時代この旗は案内でしかなく、信頼の起点は `NODE_EXTRA_CA_CERTS` を
 * 通して Node へ別経路で渡す必要があった。grpc-js は CA を credentials で受け取る
 * ので、旗がすべてになる。
 */
import { readFileSync } from "node:fs";
import { credentials, type ChannelCredentials } from "@grpc/grpc-js";
import { CaptureServiceClient } from "./generated/browserhive/v1/capture.js";

/**
 * 何も言われないときに BrowserHive が待ち受けている場所。OpenAPI の SDK はこれを
 * `servers[0].url` から焼き込んでいたので、`--server` を省いても既定値に届いていた。
 * `.proto` は宛先を運ばないので、その既定値はいまここに在る。
 */
export const DEFAULT_TARGET = "localhost:50051";

let client: CaptureServiceClient | undefined;

/**
 * gRPC の宛先は URL ではなく `host:port`。それでも scheme を書く呼び出し ——
 * 癖で、あるいは HTTP 転送の時代に書かれた設定から —— に対しては、`http` という
 * 名前の host へ繋ぎに行くのではなく、scheme を落とす。
 */
const toTarget = (server: string | undefined): string =>
  (server ?? DEFAULT_TARGET).replace(/^[a-z]+:\/\//, "").replace(/\/+$/, "");

/**
 * CA が名指しされているときに TLS が有効になる。「システムの root で TLS」を
 * 求める手段は用意していない —— BrowserHive の TLS は私設 CA を想定したもので、
 * 公開の証明書が要るということは server が公開インターネット上に在るという意味に
 * なるが、そうではないため。
 */
const buildCredentials = (tlsCaCert: string | undefined): ChannelCredentials =>
  tlsCaCert === undefined
    ? credentials.createInsecure()
    : credentials.createSsl(readFileSync(tlsCaCert));

export const configureClient = (server: string | undefined, tlsCaCert?: string): void => {
  client?.close();
  client = new CaptureServiceClient(toTarget(server), buildCredentials(tlsCaCert));
};

/**
 * 設定済みの client。このディレクトリの呼び出しラッパのためのもの。
 *
 * 設定されていないときに throw するのは意図的: もう一方の道は既定の宛先に対して
 * 遅延生成することだが、それをすると「呼ぶ側が `--server` を渡し忘れた」が、
 * 数秒後の localhost への connection refused に化ける。
 */
export const getClient = (): CaptureServiceClient => {
  if (client === undefined) {
    throw new Error("BrowserHive client is not configured — call configureClient() first");
  }
  return client;
};

export const closeClient = (): void => {
  client?.close();
  client = undefined;
};
