import { client } from "../http/generated/client.gen.js";

/**
 * Configure the generated OpenAPI client.
 *
 * When `baseUrl` is `undefined` the SDK keeps the default extracted from
 * `servers[0].url` of the OpenAPI spec at generation time.
 *
 * For TLS server verification with a custom CA, set the
 * `NODE_EXTRA_CA_CERTS` env var to the CA cert path before starting the
 * process. The `--tls-ca-cert` CLI flag is logged for visibility but is
 * otherwise informational — Node's global `fetch` picks up the trust
 * anchor from the env var and the hey-api fetch client delegates to
 * global `fetch`.
 */
export const configureClient = (baseUrl: string | undefined): void => {
  if (baseUrl !== undefined) {
    client.setConfig({ baseUrl });
  }
};
