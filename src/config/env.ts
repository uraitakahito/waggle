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
 * `identity.ts` も同じ方針 (既定値に落とさず throw) を使うので export している。
 * この 2 つは env.ts の外へ広く配るためのものではない。
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
