/**
 * Parse the `s3://bucket/key` URIs BrowserHive reports as artifact locations.
 *
 * These come from the server, not from reconstructing a filename, so this is
 * the only place waggle needs to know anything about the shape of a key.
 * Keeping the parse in one function means a future artifact store that returns
 * a different scheme fails loudly here rather than producing a plausible-but-
 * wrong bucket somewhere downstream.
 */

export interface S3Location {
  bucket: string;
  key: string;
}

/** @throws when `uri` is not an `s3://bucket/key` with both parts present. */
export const parseS3Uri = (uri: string): S3Location => {
  const withoutScheme = uri.startsWith("s3://") ? uri.slice("s3://".length) : null;
  if (withoutScheme === null) {
    throw new Error(`not an s3:// URI: ${uri}`);
  }
  const slash = withoutScheme.indexOf("/");
  // A key may contain slashes (BrowserHive's `--s3-key-prefix` adds one), so
  // split on the first only.
  if (slash <= 0 || slash === withoutScheme.length - 1) {
    throw new Error(`s3:// URI has no bucket or no key: ${uri}`);
  }
  return {
    bucket: withoutScheme.slice(0, slash),
    key: withoutScheme.slice(slash + 1),
  };
};
