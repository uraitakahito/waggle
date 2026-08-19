/**
 * Marks a request as having gone through the mapper before it is sent.
 *
 * The generated `SubmitCaptureRequest` is a structural type, so anything of
 * the right shape — or anything cast to it, whether the shape matches or not —
 * can claim to be one. That is how BrowserHive's own e2e suite came to send
 * OpenAPI-era request bodies over a protobuf wire: a `as unknown as` cast
 * silenced the one check that would have caught it, and the encoder failed at
 * runtime with `invalid int32: undefined`.
 *
 * The `unique symbol` cannot be produced outside this module, so `sealWire` is
 * the only way to obtain a `WireSubmitCapture`. Escaping it means writing
 * `as WireSubmitCapture` by name — greppable, lintable, and visible in review.
 *
 * Only outgoing requests carry the mark. Responses arrive decoded from the
 * wire rather than assembled by anyone here, so they keep the generated type.
 */
import type { SubmitCaptureRequest } from "./generated/browserhive/v1/capture.js";

declare const wireBrand: unique symbol;

/** The mark. It exists only in the type, never at runtime. */
export type Wire<T> = T & { readonly [wireBrand]: true };

/** A request `CaptureService/SubmitCapture` will accept. */
export type WireSubmitCapture = Wire<SubmitCaptureRequest>;

/**
 * The only place the mark is applied.
 *
 * Taking a `SubmitCaptureRequest` means the type check has already happened by
 * the time control reaches here; this function only records that fact.
 */
export const sealWire = (request: SubmitCaptureRequest): WireSubmitCapture =>
  request as WireSubmitCapture;
