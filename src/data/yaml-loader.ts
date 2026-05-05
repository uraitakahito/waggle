/**
 * YAML data file parser.
 *
 * Format (YAML 1.2, top-level array of mappings):
 *
 *   - labels: [9202, ANAHoldings]
 *     url: https://www.ana.co.jp/group/
 *
 *   - labels: ["543A", Archion]   # quote alphanumeric tickers
 *     url: https://www.archion.co.jp/
 *
 * Strict by design: any malformed entry fails the whole parse with a
 * descriptive error pinpointing the offending index.
 *
 * Numeric `labels` entries (e.g. `9202`) are coerced to strings so
 * callers always see `string[]` for downstream filename generation.
 *
 * Ported from upstream BrowserHive `examples/data-file.ts`.
 */
import { parse as parseYaml } from "yaml";
import { err, ok, type Result } from "../types/result.js";

export interface DataEntry {
  labels: string[];
  url: string;
}

/**
 * `yaml.parse` is typed as returning `any`. Wrap once so the rest of this
 * module sees the safer `unknown`, satisfying `no-unsafe-assignment`.
 */
const parseYamlAsUnknown = (content: string): unknown => parseYaml(content) as unknown;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const coerceLabel = (
  value: unknown,
  entryIndex: number,
  labelIndex: number,
): Result<string, string> => {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") {
      return err(`entry[${String(entryIndex)}].labels[${String(labelIndex)}]: empty string`);
    }
    return ok(trimmed);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return ok(String(value));
  }
  return err(
    `entry[${String(entryIndex)}].labels[${String(labelIndex)}]: expected string|number, got ${typeof value}`,
  );
};

export const parseDataFile = (content: string): Result<DataEntry[], string> => {
  let parsed: unknown;
  try {
    parsed = parseYamlAsUnknown(content);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    return err(`YAML parse error: ${message}`);
  }

  if (parsed === null || parsed === undefined) {
    return ok([]);
  }

  if (!Array.isArray(parsed)) {
    return err(`Top-level must be a YAML sequence (array), got ${typeof parsed}`);
  }

  const items = parsed as unknown[];
  const entries: DataEntry[] = [];
  for (let i = 0; i < items.length; i++) {
    const raw: unknown = items[i];
    if (!isObject(raw)) {
      return err(`entry[${String(i)}]: expected mapping, got ${typeof raw}`);
    }

    const url = raw["url"];
    if (typeof url !== "string" || url.trim() === "") {
      return err(`entry[${String(i)}].url: required non-empty string`);
    }

    const labelsRaw: unknown = raw["labels"];
    const labels: string[] = [];
    if (labelsRaw !== undefined) {
      if (!Array.isArray(labelsRaw)) {
        return err(`entry[${String(i)}].labels: expected array, got ${typeof labelsRaw}`);
      }
      const labelItems = labelsRaw as unknown[];
      for (let j = 0; j < labelItems.length; j++) {
        const labelResult = coerceLabel(labelItems[j], i, j);
        if (!labelResult.ok) return labelResult;
        labels.push(labelResult.value);
      }
    }

    entries.push({ labels, url: url.trim() });
  }

  return ok(entries);
};
