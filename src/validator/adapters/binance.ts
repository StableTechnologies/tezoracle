import type { SourceConfig } from "../../config/validate.js";
import { ValidatorError } from "../errors.js";
import { getJsonPath, requirePriceString } from "./parse.js";
import { failParse, okParse, type AdapterParseResult, type SourceAdapter } from "./types.js";

export const binanceAdapter: SourceAdapter = {
  sourceId: "binance",
  parse(source: SourceConfig, json: unknown): AdapterParseResult {
    if (source.source_id !== "binance") {
      return failParse("UNAPPROVED_SOURCE", "binance adapter received a different source_id");
    }
    if (!Array.isArray(json) || json.length < 1) {
      return failParse("MALFORMED", "Binance trades response must be a non-empty array");
    }
    try {
      return okParse({
        priceText: requirePriceString(getJsonPath(json, source.price_path), "Binance price"),
        timestampRaw: getJsonPath(json, source.timestamp_path),
      });
    } catch (error) {
      if (error instanceof ValidatorError) {
        return failParse(error.code, error.message);
      }
      return failParse("MALFORMED", "Binance parse failed");
    }
  },
};
