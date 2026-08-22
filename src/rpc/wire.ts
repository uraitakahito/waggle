/**
 * 送る前に mapper を通ったことを、リクエストに印として付ける。
 *
 * 生成された `SubmitCaptureRequest` は構造的な型なので、形さえ合っていれば ——
 * 実際には合っていなくても cast すれば —— 誰でもそれを名乗れる。BrowserHive 自身の
 * e2e が OpenAPI 時代の body を protobuf の wire に送ろうとしたのがこれで、
 * `as unknown as` の cast がそれを捕まえるはずだった唯一の検査を黙らせ、encoder が
 * 実行時に `invalid int32: undefined` で落ちた。
 *
 * `unique symbol` はこのモジュールの外では作れないので、`WireSubmitCapture` を
 * 手に入れる道は `sealWire` しかない。抜け道を通るには `as WireSubmitCapture` と
 * 名前で書くことになる —— grep でき、lint でき、レビューで目に入る。
 *
 * 印が付くのは送るリクエストだけ。レスポンスは wire から復号されて届くもので、
 * ここで誰かが組み立てるものではないので、生成された型のままにする。
 */
import type { SubmitCaptureRequest } from "./generated/browserhive/v1/capture.js";

declare const wireBrand: unique symbol;

/** 印。型の上にしか存在せず、実行時には無い。 */
export type Wire<T> = T & { readonly [wireBrand]: true };

/** `CaptureService/SubmitCapture` が受け付けるリクエスト。 */
export type WireSubmitCapture = Wire<SubmitCaptureRequest>;

/**
 * 印を付ける唯一の場所。
 *
 * `SubmitCaptureRequest` を受け取るということは、ここに来る時点で型検査は済んで
 * いるということ。この関数はその事実を記録するだけ。
 */
export const sealWire = (request: SubmitCaptureRequest): WireSubmitCapture =>
  request as WireSubmitCapture;
