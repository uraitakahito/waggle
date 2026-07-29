/**
 * S3 access for the ledger: reading result manifests and listing the bucket.
 *
 * Presigning lives in `api/presign.ts` — it shares this client but is a
 * different concern (it never reads an object, it only signs).
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
 * Fetch and parse a JSON object, or `undefined` when it is not there.
 *
 * A missing object is an expected outcome (the manifest fallback asks for one
 * that may never have been written), so it is not an error. Anything else —
 * credentials, network, malformed JSON — still throws.
 */
export const getJsonObject = async <T>(
  s3: S3Client,
  bucket: string,
  key: string,
): Promise<T | undefined> => {
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const body = await result.Body?.transformToString();
    if (body === undefined) return undefined;
    return JSON.parse(body) as T;
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
 * Every key in the bucket, following pagination.
 *
 * S3 list can only narrow by prefix — there is no suffix filter and no
 * "modified since" — so the reconciler pulls the whole listing and selects
 * `.result.json` itself. That is fine at the current scale (tens of objects)
 * and is the part that would have to change first if the bucket grew into the
 * tens of thousands; the fix then is a date prefix on the BrowserHive side.
 */
export const listAllKeys = async (s3: S3Client, bucket: string): Promise<string[]> => {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ...(continuationToken !== undefined && { ContinuationToken: continuationToken }),
      }),
    );
    for (const item of page.Contents ?? []) {
      if (item.Key !== undefined) keys.push(item.Key);
    }
    continuationToken = page.IsTruncated === true ? page.NextContinuationToken : undefined;
  } while (continuationToken !== undefined);
  return keys;
};
