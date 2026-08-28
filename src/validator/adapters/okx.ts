import type { SourceConfig } from "../../config/validate.js";
import { ValidatorError } from "../errors.js";
import { getJsonPath, requirePriceString } from "./parse.js";
import { failParse, okParse, type AdapterParseResult, type SourceAdapter } from "./types.js";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const okxAdapter: SourceAdapter = {
  sourceId: "okx",
  parse(source: SourceConfig, json: unknown): AdapterParseResult {
    if (source.source_id !== "okx") {
      return failParse("UNAPPROVED_SOURCE", "okx adapter received a different source_id");
    }
    if (!isObject(json)) {
      return failParse("MALFORMED", "OKX response must be an object");
    }
    if (json.code !== "0") {
      return failParse("MALFORMED", `OKX code ${String(json.code)}`);
    }
    if (!Array.isArray(json.data) || json.data.length < 1) {
      return failParse("MALFORMED", "OKX data must be a non-empty array");
    }
    const row = json.data[0];
    if (isObject(row) && typeof row.instId === "string" && row.instId !== source.market_id) {
      return failParse("WRONG_MARKET", `OKX instId ${row.instId} != ${source.market_id}`);
    }
    try {
      return okParse({
        priceText: requirePriceString(getJsonPath(json, source.price_path), "OKX last"),
        timestampRaw: getJsonPath(json, source.timestamp_path),
        reportedMarketId: isObject(row) && typeof row.instId === "string" ? row.instId : undefined,
      });
    } catch (error) {
      if (error instanceof ValidatorError) {
        return failParse(error.code, error.message);
      }
      return failParse("MALFORMED", "OKX parse failed");
    }
  },
};
