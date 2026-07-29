import { describe, it, expect } from "vitest";
import { isAlreadyInDesiredState } from "../src/fga/client.js";

/**
 * Shapes measured against OpenFGA v1.10.2. Getting this predicate wrong is
 * expensive in both directions: too strict wedges the outbox on a row that
 * will never succeed, too loose marks a row delivered whose tuples never
 * landed — and a missing tuple only surfaces as someone being wrongly denied.
 */
const fgaError = (code: string, message: string): unknown => ({
  name: "FgaApiValidationError",
  responseData: { code },
  message: `FGA API Validation Error: post write : ${message}`,
});

describe("isAlreadyInDesiredState", () => {
  it("accepts writing a tuple that already exists", () => {
    expect(
      isAlreadyInDesiredState(
        fgaError(
          "write_failed_due_to_invalid_input",
          "Error cannot write a tuple which already exists: user: 'organization:acme', relation: 'parent', object: 'capture_job:x'",
        ),
      ),
    ).toBe(true);
  });

  it("accepts deleting a tuple that is not there", () => {
    expect(
      isAlreadyInDesiredState(
        fgaError(
          "write_failed_due_to_invalid_input",
          "Error cannot delete a tuple which does not exist: user: 'organization:acme', relation: 'parent', object: 'capture_job:x'",
        ),
      ),
    ).toBe(true);
  });

  // An unknown relation is a modelling mistake. Swallowing it would mark the
  // row delivered and lose the tuple for good.
  it("rejects a validation error from a bad relation", () => {
    expect(
      isAlreadyInDesiredState(
        fgaError("validation_error", "Error Invalid tuple 'capture_job:x#nope@organization:x'"),
      ),
    ).toBe(false);
  });

  // Same code, different cause — the message is what separates them.
  it("rejects another invalid-input failure that is not about existence", () => {
    expect(
      isAlreadyInDesiredState(
        fgaError("write_failed_due_to_invalid_input", "Error something else entirely"),
      ),
    ).toBe(false);
  });

  it("rejects transport and unknown errors", () => {
    expect(isAlreadyInDesiredState(new Error("socket hang up"))).toBe(false);
    expect(isAlreadyInDesiredState(undefined)).toBe(false);
    expect(isAlreadyInDesiredState(null)).toBe(false);
    expect(isAlreadyInDesiredState("boom")).toBe(false);
  });
});
