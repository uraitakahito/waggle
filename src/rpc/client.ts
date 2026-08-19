/**
 * The BrowserHive gRPC client.
 *
 * One channel per process, created by `configureClient` and torn down by
 * `closeClient`. The channel is a real resource — an open HTTP/2 connection
 * with its own keepalive timers — which is the main way this differs from the
 * `fetch`-based client it replaces: **a run that forgets to close it does not
 * exit.** `runClient` closes it in a `finally`.
 *
 * The other difference worth knowing is that `--tls-ca-cert` now does
 * something. Under `fetch` the flag was informational and the trust anchor had
 * to be handed to Node out-of-band through `NODE_EXTRA_CA_CERTS`; grpc-js
 * takes the CA in the credentials, so the flag is the whole story.
 */
import { readFileSync } from "node:fs";
import { credentials, type ChannelCredentials } from "@grpc/grpc-js";
import { CaptureServiceClient } from "./generated/browserhive/v1/capture.js";

/**
 * Where BrowserHive listens when nothing says otherwise. The OpenAPI SDK used
 * to bake this in from `servers[0].url`, so omitting `--server` still reached a
 * default; a `.proto` carries no address, so the default lives here now.
 */
export const DEFAULT_TARGET = "localhost:50051";

let client: CaptureServiceClient | undefined;

/**
 * gRPC targets are `host:port`, not URLs. Callers who still type a scheme —
 * out of habit, or from a config written for the HTTP transport — get it
 * stripped rather than a connection to a host literally named `http`.
 */
const toTarget = (server: string | undefined): string =>
  (server ?? DEFAULT_TARGET).replace(/^[a-z]+:\/\//, "").replace(/\/+$/, "");

/**
 * TLS is on when a CA is named. There is no way to ask for TLS-with-system-
 * roots, because BrowserHive's TLS mode is meant for a private CA — a public
 * certificate would mean the server is on the open internet, which it is not.
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
 * The configured client, for the call wrappers in this directory.
 *
 * Throwing on an unconfigured client is deliberate: the alternative is to
 * lazily build one against the default target, which turns "the caller forgot
 * to pass `--server`" into a connection refused against localhost several
 * seconds later.
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
