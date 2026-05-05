/**
 * Commander argParser helpers for the db CLIs (`migrate`, `seed`).
 *
 * Mirrors contact-api's `cli-parsers.ts` shape. Kept colocated with
 * the bin scripts that use it rather than under `src/config/` because
 * the cli-options module there is wired into the application CLI
 * surface area, while these helpers are private to migrate/seed.
 */
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { InvalidArgumentError } from "commander";

export const parsePath = (value: string): URL => {
  if (value.trim() === "") {
    throw new InvalidArgumentError("Path must not be empty.");
  }
  return pathToFileURL(path.resolve(value));
};
