/**
 * Result<T, E> — success/failure discriminated union.
 *
 * Convention: for "no value on success" cases, use `Result<void, E>`
 * (with `ok()`) rather than `Result<undefined, E>` (with `ok(undefined)`).
 *
 * Why `void` over `undefined`:
 *   - Ergonomics: callers write `ok()` instead of `ok(undefined)`. The
 *     `ok` overload below uses `void`'s special return-type compatibility
 *     rule to accept zero arguments at the type level.
 *   - Ecosystem fit: aligns with the `Promise<void>` convention used
 *     across the Node/DOM/browser APIs and TypeScript stdlib. Mixing
 *     `Promise<Result<undefined, E>>` into a codebase full of
 *     `Promise<void>` reads as a foreign idiom.
 *   - Library precedent: neverthrow, fp-ts (`Either<E, void>`), and
 *     effect-ts all use `void` for the empty-success case.
 *
 * Ported from upstream BrowserHive `src/result.ts`.
 */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/**
 * Construct a success Result.
 *
 * Two overloads:
 *   - `ok()`             → Result<void, never>   (no-value success)
 *   - `ok<T>(value: T)`  → Result<T, never>      (value-carrying success)
 *
 * The runtime value of `ok()` is `{ ok: true, value: undefined }`, which
 * is structurally compatible with `Result<void, E>` because `undefined`
 * is assignable to `void`.
 */
export const ok: {
  (): Result<void, never>;
  <T>(value: T): Result<T, never>;
} = <T>(value?: T): Result<T, never> => ({ ok: true, value: value as T });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const isOk = <T, E>(result: Result<T, E>): result is { ok: true; value: T } => result.ok;

export const isErr = <T, E>(result: Result<T, E>): result is { ok: false; error: E } => !result.ok;
