/**
 * 台帳のための S3 アクセス: 結果 manifest を読むこと、アーカイブ本体を取ること、
 * bucket を列挙すること。
 *
 * 署名付き URL は `api/presign.ts` に在る —— この client は共有するが、関心は別
 * (あちらはオブジェクトを一度も読まず、署名するだけ)。
 */
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
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

/**
 * オブジェクトを丸ごとバイト列で取る。無ければ `undefined`。
 *
 * `getJsonObject` と分けてあるのは、こちらの相手が **JSON ではない**から ——
 * WACZ (zip) を開くのに使う。文字列に変換すると壊れる。
 *
 * **丸ごと読む。** WACZ の大半は WARC なので、`pages.jsonl` 1 本のために全部を
 * 落とすことになる。それを承知でこうしている: 現物は数十 KB〜数 MB で、範囲読みの
 * 複雑さに見合わない。規模が変わったときの直し方は既に書かれていて、
 * wacz-validator の packages/core/src/wacz/s3-range-reader.ts が `HeadObject` で大きさを
 * 訊いてから yauzl に Range で食わせる形を持っている。
 */
export const getObjectBytes = async (
  s3: S3Client,
  bucket: string,
  key: string,
): Promise<Buffer | undefined> => {
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bytes = await result.Body?.transformToByteArray();
    return bytes === undefined ? undefined : Buffer.from(bytes);
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
 * bucket 内の鍵。ページ送りも辿る。`prefix` を渡せばその下だけ。
 *
 * S3 の list は prefix でしか絞れない —— **拡張子での絞り込みも「いつ以降」も無い。**
 * だから reconciler は listing を引いてから `.result.json` を自分で選ぶ。ここは
 * 変わっていない。
 *
 * 変わったのは絞る手がかりのほう。受け口が受けた成果物の鍵は ledger が決めるので、
 * `org/<orgId>/<YYYY-MM>/` という接頭辞を持つ (`api/sink.ts` の `crawlKeyPrefix`)。
 * 月ごとに分かれているので、reconciler は直近の数か月だけを歩ける。
 * **BrowserHive が自前の保管庫へ書く経路は平らなまま**で、そちらは絞れない。
 */
export const listAllKeys = async (
  s3: S3Client,
  bucket: string,
  prefix?: string,
): Promise<string[]> => {
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
        // 注意: これは `Delimiter` / `Prefix` / `StartAfter` にも掛かる。ただし
        // 掛かるのは**応答に echo される側**で、要求として送る `Prefix` は生のまま
        // 渡す (SDK が query に載せるときに符号化する)。ここは仕様の読みだけでは
        // 足りないので、実物の S3 実装に投げて確かめてある。
        EncodingType: "url",
        ...(prefix !== undefined && { Prefix: prefix }),
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

/**
 * オブジェクトを 1 つ書く。
 *
 * **冪等であること。** 同じ鍵に 2 度書けば上書きされる —— BrowserHive が再送しうるので、
 * 連番を振ると再送のたびに object が増える。鍵は呼ぶ側が決める。
 *
 * ledger が S3 に**書く**のはここだけ。他はすべて読み取りで、書くのは BrowserHive の
 * 仕事だった —— 成果物を受け口で受け取る構成にしたときに、この 1 か所が要る。
 */
export const putObject = async (
  s3: S3Client,
  bucket: string,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> => {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
};
