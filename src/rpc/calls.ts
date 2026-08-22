/**
 * 生成された grpc-js の stub を Promise で包む。
 *
 * grpc-js は callback が前提なので、包まないと呼び出しのたびに同じ `new Promise` の
 * 段取りを繰り返すことになる。reject は `ServiceError` をそのまま運ぶ ——
 * その `code` が status で、呼ぶ側は `isStatus` で絞る。
 */
import { status, type ServiceError } from "@grpc/grpc-js";
import { getClient } from "./client.js";
import type { WireSubmitCapture } from "./wire.js";
import type {
  GetCaptureRequest,
  GetCaptureResponse,
  SubmitCaptureResponse,
} from "./generated/browserhive/v1/capture.js";

export const submitCapture = (request: WireSubmitCapture): Promise<SubmitCaptureResponse> =>
  new Promise((resolve, reject) => {
    getClient().submitCapture(request, (error, response) => {
      if (error) reject(error);
      else resolve(response);
    });
  });

export const getCapture = (request: GetCaptureRequest): Promise<GetCaptureResponse> =>
  new Promise((resolve, reject) => {
    getClient().getCapture(request, (error, response) => {
      if (error) reject(error);
      else resolve(response);
    });
  });

/**
 * その reject が、指定した status を持つ gRPC の失敗かどうか。
 *
 * channel 自身が投げるもの —— DNS の失敗、拒まれた接続 —— も `ServiceError` として
 * 届き、status は `UNAVAILABLE` になる。クラスではなく code を見ているのはそのため:
 * 「これは gRPC のエラーか」は役に立つ問いではなく、「これは **タスクが無い** という
 * 答えか」が役に立つ問いだから。
 */
export const isStatus = (error: unknown, expected: status): boolean =>
  typeof error === "object" && error !== null && (error as Partial<ServiceError>).code === expected;
