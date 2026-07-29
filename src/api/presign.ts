/**
 * Turn a ledger row into a short-lived, GET-only URL for the object.
 *
 * Signing is a pure computation — no request reaches S3 — so this cannot tell
 * whether the object exists. That is deliberate: the ledger is the record of
 * what exists, and only successful captures are ever written to it.
 *
 * The expiry is short because a signed URL cannot be revoked. Once issued it
 * is valid for its full lifetime no matter what happens to the underlying
 * permission, so the window is the irreducible gap between revoking access and
 * that access actually ending.
 */
import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const DEFAULT_EXPIRES_IN_SECONDS = 300;

export interface SignedArchiveUrl {
  url: string;
  expiresIn: number;
}

export const presignArchive = async (
  s3: S3Client,
  location: { bucket: string; objectKey: string },
  expiresIn: number = DEFAULT_EXPIRES_IN_SECONDS,
): Promise<SignedArchiveUrl> => {
  const url = await getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: location.bucket, Key: location.objectKey }),
    { expiresIn },
  );
  return { url, expiresIn };
};
