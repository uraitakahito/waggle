/**
 * OpenFGA client factory and the error predicate the outbox worker depends on.
 */
import { CredentialsMethod, OpenFgaClient } from "@openfga/sdk";
import type { FgaConfig } from "../config/env.js";

export const createFgaClient = (config: FgaConfig): OpenFgaClient =>
  new OpenFgaClient({
    apiUrl: config.apiUrl,
    storeId: config.storeId,
    // Pinned on purpose — see `FgaConfig.modelId`.
    authorizationModelId: config.modelId,
    credentials: {
      method: CredentialsMethod.ApiToken,
      config: { token: config.apiToken },
    },
  });

/**
 * Whether a failed write only means "the store is already in that state".
 *
 * Delivery is at-least-once, so the worker re-sends rows it is not sure about
 * and must not treat a redundant write as a failure — otherwise one row wedges
 * and blocks everything behind it.
 *
 * Measured against OpenFGA v1.10.2, all with code
 * `write_failed_due_to_invalid_input`:
 *
 *   writing an existing tuple  → "cannot write a tuple which already exists"
 *   deleting an absent tuple   → "cannot delete a tuple which does not exist"
 *
 * and, for contrast, an unknown relation reports `validation_error` instead —
 * so the code alone does distinguish real modelling mistakes. The message is
 * still checked because `write_failed_due_to_invalid_input` is not documented
 * as covering only these two. Being too strict costs a retry; being too loose
 * would discard a tuple that never landed, and a missing tuple is invisible
 * until someone is wrongly denied access.
 */
export const isAlreadyInDesiredState = (cause: unknown): boolean => {
  if (typeof cause !== "object" || cause === null) return false;
  const err = cause as { responseData?: { code?: string }; message?: string };
  if (err.responseData?.code !== "write_failed_due_to_invalid_input") return false;
  const message = err.message ?? "";
  return message.includes("already exists") || message.includes("does not exist");
};
