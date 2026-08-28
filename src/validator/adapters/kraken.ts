import type { SourceConfig } from "../../config/validate.js";
import { ValidatorError } from "../errors.js";
import { getJsonPath, requirePriceString } from "./parse.js";
import { failParse, okParse, type AdapterParseResult, type SourceAdapter } from "./types.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const krakenAdapter: SourceAdapter = {
  sourceId: "kraken",
  parse(source: SourceConfig, json: unknown): AdapterParseResult {
    if (source.source_id !== "kraken") {
      return failParse("UNAPPROVED_SOURCE", "kraken adapter received a different source_id");
    }
    if (!isObject(json)) {
      return failParse("MALFORMED", "Kraken response must be an object");
    }
    if (!Array.isArray(json.error) || json.error.length !== 0) {
      return failParse("MALFORMED", "Kraken error array must be empty");
    }
    if (typeof source.result_pair_key !== "string") {
      return failParse("MALFORMED", "Kraken source is missing result_pair_key");
    }
    if (!isObject(json.result) || !Array.isArray(json.result[source.result_pair_key])) {
      return failParse("WRONG_MARKET", `Kraken result missing ${source.result_pair_key}`);
    }
    const trades = json.result[source.result_pair_key];
    if (!Array.isArray(trades) || trades.length < 1) {
      return failParse("MALFORMED", "Kraken trades list is empty");
    }
    try {
      return okParse({
        priceText: requirePriceString(getJsonPath(json, source.price_path), "Kraken price"),
        timestampRaw: getJsonPath(json, source.timestamp_path),
        reportedMarketId: source.result_pair_key,
      });
    } catch (error) {
      if (error instanceof ValidatorError) {
        return failParse(error.code, error.message);
      }
      return failParse("MALFORMED", "Kraken parse failed");
    }
  },
};
