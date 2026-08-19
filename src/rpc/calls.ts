/**
 * Promise wrappers around the generated grpc-js stubs.
 *
 * grpc-js is callback-first, so every call site would otherwise repeat the
 * same `new Promise` dance. Rejections carry the `ServiceError` unchanged —
 * its `code` is the status, and callers narrow on it with `isStatus`.
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
 * Whether a rejection is a gRPC failure with the given status.
 *
 * Anything thrown by the channel itself — a DNS failure, a refused connection
 * — also arrives as a `ServiceError`, with `UNAVAILABLE`. That is the reason
 * this checks the code rather than the class: "is this a gRPC error" is not a
 * useful question, "is this the *absent task* answer" is.
 */
export const isStatus = (error: unknown, expected: status): boolean =>
  typeof error === "object" && error !== null && (error as Partial<ServiceError>).code === expected;
