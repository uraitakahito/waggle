#!/usr/bin/env node
/**
 * Run OpenFGA's schema migration against the stack's `openfga-db`.
 *
 * This is a one-shot job, and container-compose has exactly four subcommands
 * (up / down / build / version) — there is no way to express it as a service.
 * The `openfga` image is distroless, so it also cannot run a shell retry loop
 * as its entrypoint the way seaweedfs does. So it runs here, invoked with
 * `container run`, the same way waxlens drives its one-shot image.
 *
 * Until this succeeds the `openfga` service answers 500 on every request
 * (including /healthz) — it starts fine against an unmigrated database and
 * only fails when it touches a table.
 *
 * Idempotent: re-running against an already-migrated database is a no-op, so
 * this is safe to call from setup scripts and from CI.
 */
import { spawnSync } from "node:child_process";

const IMAGE = process.env["WAGGLE_FGA_IMAGE"] ?? "docker.io/openfga/openfga:v1.10.2";
const URI =
  process.env["WAGGLE_FGA_DATASTORE_URI"] ??
  "postgres://openfga:openfga@openfga-db.waggle:5432/openfga?sslmode=disable";

/** attempts × delay covers a cold `openfga-db` still running initdb. */
const ATTEMPTS = 30;
const DELAY_MS = 1000;

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
  const result = spawnSync(
    "container",
    [
      "run",
      "--rm",
      IMAGE,
      "migrate",
      // Flags, not env vars: container-compose injects Docker-link-style
      // variables (OPENFGA_DB_* for the `openfga-db` service) that OpenFGA's
      // viper config picks up and misreads — `--datastore-engine` supplied via
      // env resolved to the database container's IP address. Flags win.
      "--datastore-engine=postgres",
      `--datastore-uri=${URI}`,
    ],
    { encoding: "utf8" },
  );

  if (result.status === 0) {
    process.stdout.write("openfga migrate: ok\n");
    process.exit(0);
  }

  const detail = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  if (attempt === ATTEMPTS) {
    process.stderr.write(`openfga migrate failed after ${ATTEMPTS} attempts:\n${detail}\n`);
    process.exit(1);
  }
  process.stdout.write(`openfga migrate: attempt ${attempt} failed, retrying...\n`);
  sleep(DELAY_MS);
}
