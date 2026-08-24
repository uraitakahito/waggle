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

export const fgaConfig = (): FgaConfig => ({
  apiUrl: optional("WAGGLE_FGA_API_URL", "http://localhost:8090"),
  storeId: required("WAGGLE_FGA_STORE_ID"),
  modelId: required("WAGGLE_FGA_MODEL_ID"),
  apiToken: optional("WAGGLE_FGA_API_TOKEN", "dev-key"),
});

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

export const storageConfig = (): StorageConfig => ({
  endpoint: required("WAGGLE_S3_ENDPOINT"),
  region: optional("WAGGLE_S3_REGION", "us-east-1"),
  bucket: required("WAGGLE_S3_BUCKET"),
  accessKeyId: required("WAGGLE_S3_ACCESS_KEY_ID"),
  secretAccessKey: required("WAGGLE_S3_SECRET_ACCESS_KEY"),
  forcePathStyle: optional("WAGGLE_S3_FORCE_PATH_STYLE", "false") === "true",
});
