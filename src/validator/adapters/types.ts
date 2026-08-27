import type { SourceConfig } from "../../config/validate.js";
import type { RefusalCode } from "../errors.js";

export type RawVenueQuote = {
  priceText: string;
  timestampRaw: unknown;
  reportedMarketId?: string;
};

export type AdapterOk = { ok: true; quote: RawVenueQuote };
export type AdapterFail = { ok: false; code: RefusalCode; detail: string };
export type AdapterParseResult = AdapterOk | AdapterFail;

export type SourceAdapter = {
  readonly sourceId: SourceConfig["source_id"];
  parse(source: SourceConfig, json: unknown): AdapterParseResult;
};

export function failParse(code: RefusalCode, detail: string): AdapterFail {
  return { ok: false, code, detail };
}

export function okParse(quote: RawVenueQuote): AdapterOk {
  return { ok: true, quote };
}
