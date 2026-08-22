/**
 * BrowserHive が成果物の在り処として報告する `s3://bucket/key` の URI を解析する。
 *
 * これらは server から来るもので、ファイル名を組み直したものではない。だから
 * waggle が鍵の形について何かを知る必要があるのは、ここだけ。解析を 1 つの関数に
 * 閉じておくと、別の scheme を返す成果物ストアが将来現れたとき、下流のどこかで
 * もっともらしいが違う bucket を作るのではなく、ここで大きな音を立てて失敗する。
 */

export interface S3Location {
  bucket: string;
  key: string;
}

/** @throws `uri` が両方の部分を備えた `s3://bucket/key` でないとき。 */
export const parseS3Uri = (uri: string): S3Location => {
  const withoutScheme = uri.startsWith("s3://") ? uri.slice("s3://".length) : null;
  if (withoutScheme === null) {
    throw new Error(`not an s3:// URI: ${uri}`);
  }
  const slash = withoutScheme.indexOf("/");
  // 鍵には `/` が含まれうる (BrowserHive の `--s3-key-prefix` が足す) ので、
  // 最初の 1 つだけで分ける。
  if (slash <= 0 || slash === withoutScheme.length - 1) {
    throw new Error(`s3:// URI has no bucket or no key: ${uri}`);
  }
  return {
    bucket: withoutScheme.slice(0, slash),
    key: withoutScheme.slice(slash + 1),
  };
};
