import { describe, it, expect } from "vitest";
import { isAlreadyInDesiredState } from "../src/fga/client.js";

/**
 * OpenFGA v1.10.2 で実測した形。この判定を誤ると、どちらの向きにも高くつく:
 * 厳しすぎれば決して成功しない行で outbox が詰まり、緩すぎれば tuple が入って
 * いない行を配送済みにする —— そして欠けた tuple は、誰かが不当に拒まれるという
 * 形でしか表に出ない。
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

  // 未知の relation はモデルの誤り。飲み込むと、その行を配送済みにして tuple を
  // 完全に失う。
  it("rejects a validation error from a bad relation", () => {
    expect(
      isAlreadyInDesiredState(
        fgaError("validation_error", "Error Invalid tuple 'capture_job:x#nope@organization:x'"),
      ),
    ).toBe(false);
  });

  // code は同じで原因が違う —— それを分けているのは message のほう。
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
