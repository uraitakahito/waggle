/**
 * OpenFGA と成果物ストアに話しかける部分の、環境変数から来る設定。
 *
 * これらは配備の事実であって呼ぶ側の意図ではないので、CLI の旗ではなく環境変数に
 * 置く —— `cli-options.ts` が既に引いているのと同じ線。
 *
 * どの getter も、値が無ければ既定値に落とさず throw する。store id が黙って既定値に
 * なると、認可を別のデータに対して評価することになる。bucket が黙って既定値になると、
 * 存在しないオブジェクトに対して URL を署名することになる。どちらも、起動時に失敗する
 * よりはるかに悪い。
 */

/**
 * この repo が読む環境変数の全体。**`guardEnv` の検査対象そのもの** なので、
 * 変数を足したらここにも足すこと —— `scripts/check-env.mjs` が `src/` の実際の
 * 読み取りと突き合わせ、漏れていれば CI が落ちる。
 *
 * required と optional を分けているのは、空文字の扱いが違うから。required の
 * 空は `collectEnv` が「不足」として報告するので、`guardEnv` は見ない。
 * 同じ誤りを 2 か所から報告すると、どちらを直せばよいのか分からなくなる。
 *
 * `scripts/` だけが読む変数はここには入らない (`scripts/env.mjs` の SCRIPT_ENV)。
 */
export const REQUIRED_ENV = [
  "WAGGLE_S3_ENDPOINT",
  "WAGGLE_S3_BUCKET",
  "WAGGLE_S3_ACCESS_KEY_ID",
  "WAGGLE_S3_SECRET_ACCESS_KEY",
  "WAGGLE_FGA_STORE_ID",
  "WAGGLE_FGA_MODEL_ID",
  "WAGGLE_DEV_SUBJECT",
] as const;

export const OPTIONAL_ENV = [
  "WAGGLE_S3_REGION",
  "WAGGLE_S3_FORCE_PATH_STYLE",
  "WAGGLE_FGA_API_URL",
  "WAGGLE_FGA_API_TOKEN",
  "WAGGLE_DEV_ORGANIZATIONS",
  "WAGGLE_DEV_IDENTITY",
  "DATABASE_URL",
  "BROWSERHIVE_SERVER",
  "BROWSERHIVE_TLS_CA_CERT",
  "LOG_LEVEL",
  "REPLAY_ORIGIN",
  "MIGRATION_FOLDER",
  "SEED_FOLDER",
  "WAGGLE_API_PORT",
  "WAGGLE_DRAIN_INTERVAL_MS",
] as const;

/**
 * 「空で設定されている」optional な変数を返す。副作用は持たないので、
 * テストから直接呼べる。
 */
export const blankOptionalEnv = (): string[] =>
  OPTIONAL_ENV.filter((name) => process.env[name] === "");

/**
 * 空で設定されている optional な変数があれば、起動時に落とす。
 *
 * 空文字は無害ではない。`DATABASE_URL=` は commander の
 * `makeOptionMandatory` を **通り**、API は起動し、`/healthz` は 200 を返し、
 * 最初のクエリでようやく SASL のエラーになる —— 変数名がどこにも出ない形で。
 * 行ごと消せば即座に名指しで落ちるので、**空文字は「無い」より悪い**。
 *
 * **module body で呼ぶ。** 読み手の多くは module body で env を読むので、
 * 関数の中から呼ぶ形にすると間に合わない。commander の `.env()` が読むのは
 * `program.parse()` のとき、つまりすべての import の後なので、ここで走れば
 * 確実に先回りできる。
 */
const guardEnv = (): void => {
  const blank = blankOptionalEnv();
  if (blank.length === 0) return;
  process.stderr.write(
    `空で設定されている環境変数:\n${blank.map((name) => `  - ${name}`).join("\n")}\n\n` +
      "  値を書くか、行ごと消すこと。空文字は既定値を潰します。\n" +
      "  .env.example では、生の空行を書いてよいのは必須の変数だけです。\n",
  );
  process.exit(1);
};

guardEnv();

/**
 * `identity.ts` も同じ方針 (既定値に落とさず throw) を使うので export している。
 * この 2 つは env.ts の外へ広く配るためのものではない。
 *
 * どちらも空文字を「無い」と同じに扱う。POSIX の `${VAR:-word}` 側の意味で、
 * `??` (`${VAR-word}` 側) は使わないこと —— この repo では読み口をこちらに
 * 揃えてある。
 */
export const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set`);
  }
  return value;
};

export const optional = (name: string, fallback: string): string => {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
};

/**
 * 足りない環境変数を **まとめて** 報告するための、`required` の収集版。
 *
 * `required` は最初の 1 個で throw するので、4 つ欠けていれば 4 回起動し直す
 * ことになる。1 往復は 1 秒なので遅さは問題ではない —— 問題は **あと何個
 * あるのかが最後まで分からない** こと。3 個目を直したとき、それが最後なのかを
 * 判断する材料が無い。
 */
export class MissingEnvError extends Error {
  constructor(readonly names: string[]) {
    super(
      `環境変数が足りない:\n${names.map((name) => `  - ${name}`).join("\n")}\n\n` +
        "  cp .env.example .env  して埋めること (./setup.sh がこれをやる)。",
    );
    this.name = "MissingEnvError";
  }
}

export type Need = (name: string) => string;

/**
 * `build` が要求した環境変数のうち欠けているものを集め、1 度だけ投げる。
 *
 * 収集の範囲を module 変数ではなく builder の引数で配るのは意図的。
 * 「いま収集中」を module に持つと、範囲が呼び出しの形から消えるうえ、
 * テストの並行実行も壊れる。
 *
 * **範囲は起動 1 回であって factory 1 つではない。** `api/server.ts` は S3 と
 * OpenFGA の設定を続けて建てるので、factory ごとに集めると 1 つ目で投げて
 * 2 つ目は評価されず、往復が 2 回残る。呼ぶ側が 1 つの `collectEnv` の中で
 * 両方を建てること。
 */
export const collectEnv = <T>(build: (need: Need) => T): T => {
  const missing: string[] = [];
  const need: Need = (name) => {
    const value = process.env[name];
    if (value === undefined || value === "") {
      missing.push(name);
      // 空文字を返して **建てるのは続ける**。ここで throw すると、この関数の
      // 存在意義である「残りも数える」が消える。
      return "";
    }
    return value;
  };
  const built = build(need);
  if (missing.length > 0) {
    throw new MissingEnvError(missing);
  }
  return built;
};

export interface FgaConfig {
  apiUrl: string;
  storeId: string;
  /**
   * 意図して固定している。認可モデルは不変で、書き込むたびに新しい id が生まれる。
   * 省くと「そのとき最も新しいもの」に対して評価するので、モデルを編集した瞬間に
   * すべての判断が変わってしまう。この変数を上げることが、その切り替えを別個の
   * 意図的な行為にしている。
   */
  modelId: string;
  apiToken: string;
}

/**
 * 単体で呼ぶときは `fgaConfig()`。他の設定と一緒に建てるなら、呼ぶ側の
 * `collectEnv` にこれを渡して欠落をまとめる。
 */
export const fgaFrom = (need: Need): FgaConfig => ({
  apiUrl: optional("WAGGLE_FGA_API_URL", "http://localhost:8090"),
  storeId: need("WAGGLE_FGA_STORE_ID"),
  modelId: need("WAGGLE_FGA_MODEL_ID"),
  apiToken: optional("WAGGLE_FGA_API_TOKEN", "dev-key"),
});

export const fgaConfig = (): FgaConfig => collectEnv(fgaFrom);

export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /**
   * 同梱の SeaweedFS は bucket の subdomain 用のワイルドカード DNS を持たないので、
   * virtual-hosted 形式の宛先は当たらない。BrowserHive 自身の
   * `BROWSERHIVE_S3_FORCE_PATH_STYLE` と対になっている。
   */
  forcePathStyle: boolean;
}

export const storageFrom = (need: Need): StorageConfig => ({
  endpoint: need("WAGGLE_S3_ENDPOINT"),
  region: optional("WAGGLE_S3_REGION", "us-east-1"),
  bucket: need("WAGGLE_S3_BUCKET"),
  accessKeyId: need("WAGGLE_S3_ACCESS_KEY_ID"),
  secretAccessKey: need("WAGGLE_S3_SECRET_ACCESS_KEY"),
  forcePathStyle: optional("WAGGLE_S3_FORCE_PATH_STYLE", "false") === "true",
});

export const storageConfig = (): StorageConfig => collectEnv(storageFrom);
