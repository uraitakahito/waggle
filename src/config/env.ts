/**
 * Environment-derived configuration for the pieces that talk to OpenFGA and
 * the artifact store.
 *
 * These are deployment facts, not caller intent, so they live in env vars
 * rather than CLI flags — the same split `cli-options.ts` already draws.
 *
 * Every getter throws on a missing value instead of defaulting. A silently
 * defaulted store id would evaluate authorization against the wrong data, and
 * a silently defaulted bucket would sign URLs for objects that are not there;
 * both are much worse than failing at startup.
 */

const required = (name: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set`);
  }
  return value;
};

const optional = (name: string, fallback: string): string => {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
};

export interface FgaConfig {
  apiUrl: string;
  storeId: string;
  /**
   * Pinned deliberately. Authorization models are immutable and every write
   * mints a new id; omitting it evaluates against whatever is newest, so
   * editing the model would change every decision the moment it lands.
   * Bumping this variable is what makes that switch a separate, deliberate act.
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
   * The bundled SeaweedFS has no wildcard DNS for bucket subdomains, so
   * virtual-hosted-style addressing fails against it. Mirrors BrowserHive's
   * own `BROWSERHIVE_S3_FORCE_PATH_STYLE`.
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
