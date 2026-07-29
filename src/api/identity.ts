/**
 * Who is making this request.
 *
 * ## This is a seam, not an implementation
 *
 * Authenticating the caller is a separate problem from authorizing them, and
 * it depends on an identity provider that has not been chosen. What the
 * authorization layer needs from it is small and stable — a subject and the
 * organizations they belong to — so that shape is fixed here and the
 * verification behind it can be replaced without touching anything else.
 *
 * The dev resolver below trusts headers. That is only safe because it refuses
 * to run unless explicitly switched on, and it says so loudly at startup. When
 * a real IdP arrives, add a resolver that verifies a JWT and make it the
 * default; nothing in `routes.ts` changes.
 *
 * ## Why organizations come from the token
 *
 * Membership is not stored in OpenFGA. It is passed per request as a
 * contextual tuple, so joining or leaving an organization never has to be
 * synchronised into the authorization store — the token is already the source
 * of truth for it. The cost is that revocation waits for the token to expire,
 * which is why tokens should be short-lived.
 */
import type { FastifyRequest } from "fastify";

export interface Identity {
  subject: string;
  organizations: string[];
}

export type IdentityResolver = (request: FastifyRequest) => Promise<Identity | undefined>;

/**
 * Header-trusting resolver for local development.
 *
 * `X-Waggle-Subject` and `X-Waggle-Organizations` (comma-separated) are taken
 * at face value — anyone who can reach the port can claim to be anyone. Only
 * reachable when `WAGGLE_DEV_IDENTITY=1`.
 */
export const devIdentityResolver: IdentityResolver = (request) => {
  const subject = request.headers["x-waggle-subject"];
  if (typeof subject !== "string" || subject === "") return Promise.resolve(undefined);

  const orgHeader = request.headers["x-waggle-organizations"];
  const organizations =
    typeof orgHeader === "string"
      ? orgHeader
          .split(",")
          .map((org) => org.trim())
          .filter((org) => org !== "")
      : [];

  return Promise.resolve({ subject, organizations });
};

/** Refuses everyone. The default, so an unconfigured deployment cannot leak. */
export const denyAllResolver: IdentityResolver = () => Promise.resolve(undefined);

export const resolveIdentityResolver = (): IdentityResolver =>
  process.env["WAGGLE_DEV_IDENTITY"] === "1" ? devIdentityResolver : denyAllResolver;
