/**
 * Result<T, E> —— 成功と失敗の discriminated union。
 *
 * 約束事: 「成功しても値が無い」場合は `Result<undefined, E>` (`ok(undefined)`) では
 * なく `Result<void, E>` (`ok()`) を使う。
 *
 * `undefined` ではなく `void` にしている理由:
 *   - 書き味: 呼ぶ側が `ok(undefined)` ではなく `ok()` と書ける。下の `ok` の
 *     overload は `void` の戻り値互換の特別扱いを使って、型の上で引数 0 個を
 *     受け付けている。
 *   - 生態系との一致: Node / DOM / ブラウザの API と TypeScript の標準ライブラリで
 *     使われている `Promise<void>` の慣習に揃う。`Promise<void>` だらけの codebase に
 *     `Promise<Result<undefined, E>>` が混ざると異物に見える。
 *   - ライブラリの先例: neverthrow、fp-ts (`Either<E, void>`)、effect-ts の
 *     いずれも「値の無い成功」に `void` を使っている。
 *
 * `void` の代償はその緩い戻り値互換 (`() => void` が期待される場所にはどんな関数型も
 * 代入できる)。この規則は `value: void` というフィールド自体を弱めるものではなく、
 * 関数型を代入するときにしか効かないので、ここでの Result の使い方では書き味と
 * 生態系との一致のほうが勝つ。
 *
 * 上流の BrowserHive `src/result.ts` からの移植。
 */
export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/**
 * 成功の Result を作る。
 *
 * overload は 2 つ:
 *   - `ok()`             → Result<void, never>   (値の無い成功)
 *   - `ok<T>(value: T)`  → Result<T, never>      (値を運ぶ成功)
 *
 * `ok()` の実行時の値は `{ ok: true, value: undefined }` で、`undefined` が `void` に
 * 代入できるおかげで `Result<void, E>` と構造的に互換になる。
 */
export const ok: {
  (): Result<void, never>;
  <T>(value: T): Result<T, never>;
} = <T>(value?: T): Result<T, never> => ({ ok: true, value: value as T });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const isOk = <T, E>(result: Result<T, E>): result is { ok: true; value: T } => result.ok;

export const isErr = <T, E>(result: Result<T, E>): result is { ok: false; error: E } => !result.ok;
