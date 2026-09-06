/**
 * 台帳のための S3 アクセス: 結果 manifest を読むことと、bucket を列挙すること。
 *
 * 署名付き URL は `api/presign.ts` に在る —— この client は共有するが、関心は別
 * (あちらはオブジェクトを一度も読まず、署名するだけ)。
 */
import { GetObjectCommand, ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import type { StorageConfig } from "../config/env.js";

export const createS3Client = (config: StorageConfig): S3Client =>
  new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: config.forcePathStyle,
  });

/**
 * JSON のオブジェクトを取って解析する。無ければ `undefined`。
 *
 * オブジェクトが無いのは想定内の結果 (manifest の代替経路は、そもそも書かれて
 * いないかもしれないものを求める) なので、エラーではない。それ以外 —— 資格情報、
 * ネットワーク、壊れた JSON —— は今までどおり throw する。
 */
export const getJsonObject = async (
  s3: S3Client,
  bucket: string,
  key: string,
): Promise<unknown> => {
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await result.Body?.transformToString();
    if (body === undefined) return undefined;
    // 解析は呼ぶ側の仕事 (readManifest など)。ここで型を名乗らせない ——
    // 名乗れるようにすると、いつか誰かが検査せずに名乗る。
    return JSON.parse(body);
  } catch (cause) {
    if (isNotFound(cause)) return undefined;
    throw cause;
  }
};

const isNotFound = (cause: unknown): boolean => {
  if (typeof cause !== "object" || cause === null) return false;
  const err = cause as { name?: string; $metadata?: { httpStatusCode?: number } };
  return err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404;
};

/**
 * bucket 内のすべての鍵。ページ送りも辿る。
 *
 * S3 の list は prefix でしか絞れない —— 拡張子での絞り込みも「いつ以降」も無い ——
 * ので、reconciler は listing を全部引いてから `.result.json` を自分で選ぶ。今の
 * 規模 (数十オブジェクト) なら問題なく、bucket が数万に育ったとき最初に変える
 * べきなのがここ。そのときの直し方は、BrowserHive 側の鍵に日付の prefix を入れること。
 */
export const listAllKeys = async (s3: S3Client, bucket: string): Promise<string[]> => {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        // 応答は XML で、XML 1.0 は ASCII 0-8 などを表せない。付けないと、
        // 制御文字を含む鍵は **オブジェクトが在るのに一覧に出てこない**。
        // 付けた以上、下で復号する必要がある (SDK v3 は復号してくれない)。
        //
        // 注意: これは `Delimiter` / `Prefix` / `StartAfter` にも掛かる ——
        // 下の「日付の prefix を入れる」をやるときに踏む。
        EncodingType: "url",
        ...(continuationToken !== undefined && { ContinuationToken: continuationToken }),
      }),
    );
    for (const item of page.Contents ?? []) {
      // EncodingType を付けたので percent-encoded で返る。復号しないと
      // BrowserHive が組む名前と突き合わせられない。
      if (item.Key !== undefined) keys.push(decodeURIComponent(item.Key));
    }
    continuationToken = page.IsTruncated === true ? page.NextContinuationToken : undefined;
  } while (continuationToken !== undefined);
  return keys;
};
