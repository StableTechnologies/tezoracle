import type { SourceConfig } from "../../config/validate.js";
import { ValidatorError } from "../errors.js";
import { getJsonPath, requirePriceString } from "./parse.js";
import { failParse, okParse, type AdapterParseResult, type SourceAdapter } from "./types.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const coinbaseAdapter: SourceAdapter = {
  sourceId: "coinbase",
  parse(source: SourceConfig, json: unknown): AdapterParseResult {
    if (source.source_id !== "coinbase") {
      return failParse("UNAPPROVED_SOURCE", "coinbase adapter received a different source_id");
    }
    if (!isObject(json)) {
      return failParse("MALFORMED", "Coinbase ticker must be an object");
    }
    if (typeof json.product_id === "string" && json.product_id !== source.market_id) {
      return failParse("WRONG_MARKET", `Coinbase product_id ${json.product_id} != ${source.market_id}`);
    }
    try {
      return okParse({
        priceText: requirePriceString(getJsonPath(json, source.price_path), "Coinbase price"),
        timestampRaw: getJsonPath(json, source.timestamp_path),
        reportedMarketId: typeof json.product_id === "string" ? json.product_id : undefined,
      });
    } catch (error) {
      if (error instanceof ValidatorError) {
        return failParse(error.code, error.message);
      }
      return failParse("MALFORMED", "Coinbase parse failed");
    }
  },
};
