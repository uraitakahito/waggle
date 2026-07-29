/**
 * Deliver queued relationship tuples from `fga_outbox` to OpenFGA.
 *
 * At-least-once: a row stays until OpenFGA has accepted it, and duplicate
 * writes are treated as success. The alternative — deleting on send — would
 * lose tuples whenever the process died between the write and the update, and
 * a missing tuple is invisible until someone is wrongly denied access.
 *
 * `FOR UPDATE SKIP LOCKED` means several drains can run at once (the API
 * process on a timer, plus a manual `waggle fga:drain`) without processing the
 * same row twice and without blocking each other.
 */
import { sql, type Kysely } from "kysely";
import type { OpenFgaClient } from "@openfga/sdk";
import type { Database } from "../db/database.js";
import { isAlreadyInDesiredState } from "./client.js";
import { createChildLogger } from "../logger.js";

const log = createChildLogger({ module: "fga-outbox" });

/** OpenFGA caps a single write at 100 tuples; batches here are far smaller. */
const DEFAULT_BATCH_SIZE = 100;

export interface DrainResult {
  delivered: number;
  failed: number;
}

interface TupleKey {
  user: string;
  relation: string;
  object: string;
}

interface WritePayload {
  writes?: TupleKey[];
  deletes?: TupleKey[];
}

/**
 * Deliver one outbox row's tuples, tolerating ones that are already there.
 *
 * The subtlety that makes this more than `fga.write(payload)`: **an OpenFGA
 * write is transactional across the whole batch**. If any tuple in it already
 * exists the entire request is rejected, and nothing is written — including
 * the tuples that were new. Treating that rejection as "already delivered"
 * therefore silently drops the new ones, and the loss is invisible until
 * someone is wrongly denied access.
 *
 * That is not hypothetical: a row containing a fresh `archive` tuple beside an
 * `organization → capture_job` tuple from an earlier row hits it every time,
 * which is exactly what a re-registered archive produces.
 *
 * So: try the batch first (one request, atomic, the common case), and only if
 * it fails *because* something already exists, retry tuple by tuple so the new
 * ones still land. Any other failure propagates and the row is retried whole.
 */
const writePayload = async (fga: OpenFgaClient, payload: WritePayload): Promise<void> => {
  try {
    await fga.write(payload);
    return;
  } catch (cause) {
    if (!isAlreadyInDesiredState(cause)) throw cause;
  }

  for (const tuple of payload.writes ?? []) {
    try {
      await fga.write({ writes: [tuple] });
    } catch (cause) {
      if (!isAlreadyInDesiredState(cause)) throw cause;
      log.debug({ tuple }, "Tuple already present; skipping");
    }
  }
  for (const tuple of payload.deletes ?? []) {
    try {
      await fga.write({ deletes: [tuple] });
    } catch (cause) {
      // Deleting an absent tuple reports the same class of error and is
      // equally already-in-the-desired-state.
      if (!isAlreadyInDesiredState(cause)) throw cause;
      log.debug({ tuple }, "Tuple already absent; skipping");
    }
  }
};

export const drainOutbox = async (
  db: Kysely<Database>,
  fga: OpenFgaClient,
  batchSize = DEFAULT_BATCH_SIZE,
): Promise<DrainResult> => {
  let delivered = 0;
  let failed = 0;

  // The whole batch runs inside one transaction so the row locks taken by
  // SKIP LOCKED are held for as long as we are working on those rows.
  await db.transaction().execute(async (trx) => {
    const rows = await trx
      .selectFrom("fgaOutbox")
      .select(["id", "payload", "attempts"])
      .where("processedAt", "is", null)
      .orderBy("id")
      .limit(batchSize)
      .forUpdate()
      .skipLocked()
      .execute();

    for (const row of rows) {
      const payload = row.payload as WritePayload;
      try {
        await writePayload(fga, payload);
      } catch (cause) {
        failed += 1;
        await trx
          .updateTable("fgaOutbox")
          .set({
            attempts: row.attempts + 1,
            lastError: cause instanceof Error ? cause.message : String(cause),
          })
          .where("id", "=", row.id)
          .execute();
        log.error(
          { outboxId: row.id, attempts: row.attempts + 1, err: cause },
          "Outbox delivery failed; will retry",
        );
        // Leave processedAt null: the row is picked up again next drain.
        continue;
      }

      await trx
        .updateTable("fgaOutbox")
        .set({ processedAt: sql<string>`now()` })
        .where("id", "=", row.id)
        .execute();
      delivered += 1;
    }
  });

  if (delivered > 0 || failed > 0) {
    log.info({ delivered, failed }, "Outbox drained");
  }
  return { delivered, failed };
};
