/**
 * scripts/ 用の環境変数の読み口。`src/config/env.ts` の `optional` と
 * **同じ意味** を持つ双子。
 *
 * 双子になっているのは、scripts が .mjs で TypeScript を import できないため。
 * 意味がずれると「src では既定値、scripts では空文字」という気づきにくい差が
 * 生まれるので、`check-env.mjs` が両方を **振る舞いで** 突き合わせている。
 *
 * 空文字を「無い」と同じに扱うのは POSIX の `${VAR:-word}` 側の意味。
 * `??` は `${VAR-word}` 側 (未設定のときだけ既定値) なので、ここでは使わない。
 */

export const optional = (name, fallback) => {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
};

/**
 * scripts/ が読む環境変数。`guardEnv` の検査対象そのもの。
 *
 * どれも既定値を持つ。必須のものは無いので、required との区別は要らない。
 */
export const SCRIPT_ENV = [
  "WAGGLE_FGA_API_URL",
  "WAGGLE_FGA_API_TOKEN",
  "WAGGLE_FGA_STORE_NAME",
  "WAGGLE_FGA_IMAGE",
  "WAGGLE_FGA_DATASTORE_URI",
];

/**
 * 「空で設定されている」変数を起動時に落とす。`src/config/env.ts` の同名の
 * 関数と対になっている。
 *
 * 空文字は無害ではない。既定値を持つ変数が空で設定されていると、読み口に
 * よっては既定値を失ったまま進み、ずっと後の無関係な場所で壊れる。
 * 行ごと消せば既定値が効くので、**空文字は「無い」より悪い**。
 *
 * module body で呼ぶこと。scripts はどれもトップレベルで env を読むので、
 * 関数の中から呼ぶ形にすると間に合わない。
 */
export const guardEnv = () => {
  const blank = SCRIPT_ENV.filter((name) => process.env[name] === "");
  if (blank.length === 0) return;
  process.stderr.write(
    `空で設定されている環境変数:\n${blank.map((name) => `  - ${name}`).join("\n")}\n\n` +
      "  値を書くか、行ごと消すこと。空文字は既定値を潰します。\n" +
      "  .env.example では、生の空行を書いてよいのは必須の変数だけです。\n",
  );
  process.exit(1);
};
