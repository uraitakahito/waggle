import { describe, it, expect } from "vitest";
import { parseDataFile } from "../src/data/yaml-loader.js";

describe("parseDataFile", () => {
  it("parses a simple sequence of mappings", () => {
    const content = `
- labels: ["Apple"]
  url: https://www.apple.com/
- labels: ["Microsoft"]
  url: https://www.microsoft.com/
`;
    const result = parseDataFile(content);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([
      { labels: ["Apple"], url: "https://www.apple.com/" },
      { labels: ["Microsoft"], url: "https://www.microsoft.com/" },
    ]);
  });

  it("coerces numeric labels to strings", () => {
    const content = `
- labels: [9202, "ANAHoldings"]
  url: https://www.ana.co.jp/group/
`;
    const result = parseDataFile(content);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]?.labels).toEqual(["9202", "ANAHoldings"]);
  });

  it("coerces boolean labels to strings", () => {
    const content = `
- labels: [true, false]
  url: https://example.com/
`;
    const result = parseDataFile(content);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]?.labels).toEqual(["true", "false"]);
  });

  it("treats labels as optional and defaults to empty array", () => {
    const content = `
- url: https://example.com/
`;
    const result = parseDataFile(content);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([{ labels: [], url: "https://example.com/" }]);
  });

  it("trims whitespace from URLs", () => {
    const content = `
- labels: ["X"]
  url: "  https://example.com/  "
`;
    const result = parseDataFile(content);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]?.url).toBe("https://example.com/");
  });

  it("returns empty array for empty input", () => {
    const result = parseDataFile("");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it("rejects non-array top-level", () => {
    const content = `key: value`;
    const result = parseDataFile(content);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Top-level must be a YAML sequence/);
  });

  it("rejects entry without url", () => {
    const content = `
- labels: ["X"]
`;
    const result = parseDataFile(content);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/entry\[0\]\.url: required non-empty string/);
  });

  it("rejects entry with empty url string", () => {
    const content = `
- labels: ["X"]
  url: "   "
`;
    const result = parseDataFile(content);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/entry\[0\]\.url: required non-empty string/);
  });

  it("rejects empty string label", () => {
    const content = `
- labels: ["", "Apple"]
  url: https://example.com/
`;
    const result = parseDataFile(content);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/entry\[0\]\.labels\[0\]: empty string/);
  });

  it("rejects non-array labels", () => {
    const content = `
- labels: "Apple"
  url: https://example.com/
`;
    const result = parseDataFile(content);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/entry\[0\]\.labels: expected array/);
  });

  it("rejects non-mapping entry", () => {
    const content = `
- "string-instead-of-mapping"
`;
    const result = parseDataFile(content);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/entry\[0\]: expected mapping/);
  });

  it("returns parse error on malformed YAML", () => {
    const content = `- labels: [unterminated`;
    const result = parseDataFile(content);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/YAML parse error/);
  });

  it("pinpoints the offending entry index in error", () => {
    const content = `
- labels: ["A"]
  url: https://example.com/
- labels: ["B"]
  # url missing on entry[1]
- labels: ["C"]
  url: https://example.org/
`;
    const result = parseDataFile(content);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/entry\[1\]\.url/);
  });
});
