import { PRICE_NAT_MAX } from "../packing/types.js";
import type { AssetConfig, RegisterConfig, SourceConfig } from "../config/validate.js";
import { HttpError, sourceUrl, type HttpTransport } from "./adapters/http.js";
import { parseVenueTimestamp } from "./adapters/parse.js";
import { getAdapter } from "./adapters/registry.js";
import { assertPositivePrice, parseDecimalString, scaleToDecimals, mulScale } from "./decimal.js";
import { ValidatorError } from "./errors.js";
import type { ExcludedSource, SourceObservation, UsdtFactor } from "./types.js";

export type SourceAttempt =
  | { ok: true; observation: SourceObservation }
  | { ok: false; excluded: ExcludedSource };

function excluded(source: SourceConfig, code: string, detail: string): SourceAttempt {
  return { ok: false, excluded: { source_id: source.source_id, code, detail } };
}

export async function fetchSource(source: SourceConfig, transport: HttpTransport): Promise<SourceAttempt> {
  if (source.adapter_status !== "initial_phase") {
    return excluded(source, "UNAPPROVED_SOURCE", "stretch sources do not count until an adapter is initial_phase");
  }
  const adapter = getAdapter(source.source_id);
  if (!adapter) {
    return excluded(source, "UNAPPROVED_SOURCE", `no adapter for ${source.source_id}`);
  }
  const url = sourceUrl(source.endpoint, source.query);
  try {
    const response = await transport({
      url,
      method: "GET",
      timeout_ms: source.timeout_ms,
      max_response_bytes: source.max_response_bytes,
    });
    if (new URL(response.finalUrl).host !== new URL(source.endpoint).host) {
      return excluded(source, "MALFORMED", "redirect changed host");
    }
    if (response.status < 200 || response.status >= 300) {
      return excluded(source, "HTTP_STATUS", `HTTP ${response.status}`);
    }
    if (response.contentType.length > 0 && !/json/i.test(response.contentType)) {
      return excluded(source, "MALFORMED", "content-type is not JSON");
    }
    let json: unknown;
    try {
      json = JSON.parse(response.body) as unknown;
    } catch {
      return excluded(source, "MALFORMED", "body is not JSON");
    }
    const parsed = adapter.parse(source, json);
    if (!parsed.ok) {
      return excluded(source, parsed.code, parsed.detail);
    }
    return { ok: true, observation: quoteToObservation(source, parsed.quote.priceText, parsed.quote.timestampRaw) };
  } catch (error) {
    if (error instanceof HttpError) {
      return excluded(source, error.code, error.message);
    }
    if (error instanceof ValidatorError) {
      return excluded(source, error.code, error.message);
    }
    return excluded(source, "INTERNAL", "source fetch failed");
  }
}

function quoteToObservation(source: SourceConfig, priceText: string, timestampRaw: unknown): SourceObservation {
  const parsed = parseDecimalString(priceText);
  const venueTime = parseVenueTimestamp(timestampRaw, source.timestamp_encoding);
  return {
    source_id: source.source_id,
    venue: source.venue,
    independence_group: source.independence_group,
    market_id: source.market_id,
    endpoint: source.endpoint,
    query: source.query,
    base_asset: source.base_asset,
    quote_asset: source.quote_asset,
    unit: source.quote_asset,
    venue_observation_time: venueTime,
    raw_price: parsed.mantissa.toString(),
    raw_decimals: parsed.decimals,
    normalized_price: parsed.mantissa.toString(),
    conversion: null,
  };
}

export function applyTimeAndNormalization(
  source: SourceConfig,
  raw: SourceObservation,
  asset: AssetConfig,
  register: RegisterConfig,
  now: number,
  usdt: UsdtFactor | undefined,
): SourceAttempt {
  const venueTime = raw.venue_observation_time;
  if (venueTime < 1) {
    return excluded(source, "BAD_TIMESTAMP", "observation_time must be >= 1");
  }
  if (venueTime > now + register.time_policy.max_clock_skew_seconds) {
    return excluded(source, "BAD_TIMESTAMP", "venue time is in the future");
  }
  if (now - venueTime > asset.max_observation_age_seconds) {
    return excluded(source, "BAD_TIMESTAMP", "venue time is stale");
  }

  let scaled: bigint;
  try {
    scaled = assertPositivePrice(
      scaleToDecimals({ mantissa: BigInt(raw.raw_price), decimals: raw.raw_decimals }, asset.decimals),
      "scaled price",
    );
  } catch (error) {
    if (error instanceof ValidatorError) {
      return excluded(source, error.code, error.message);
    }
    return excluded(source, "BAD_NUMBER", "scale failed");
  }

  if (source.quote_conversion === "none") {
    return {
      ok: true,
      observation: { ...raw, normalized_price: scaled.toString(), conversion: null },
    };
  }

  if (!usdt) {
    return excluded(source, "INSUFFICIENT", "USDT_USD factor is required for usdt_usd conversion");
  }
  if (usdt.decimals !== asset.decimals) {
    return excluded(source, "BAD_NUMBER", "USDT factor decimals must match the asset");
  }
  let usd: bigint;
  try {
    usd = assertPositivePrice(mulScale(scaled, usdt.price, asset.decimals), "USDT-adjusted price");
  } catch (error) {
    if (error instanceof ValidatorError) {
      return excluded(source, error.code, error.message);
    }
    return excluded(source, "BAD_NUMBER", "USDT conversion failed");
  }
  if (usd > PRICE_NAT_MAX) {
    return excluded(source, "BAD_NUMBER", "USDT-adjusted price exceeds price_nat_max");
  }
  return {
    ok: true,
    observation: {
      ...raw,
      normalized_price: usd.toString(),
      conversion: {
        via_asset_id: "USDT_USD",
        factor: usdt.price.toString(),
        factor_decimals: usdt.decimals,
        factor_observation_time: usdt.observation_time,
      },
    },
  };
}

export async function observeAssetSources(
  sources: SourceConfig[],
  transport: HttpTransport,
): Promise<Map<string, SourceAttempt>> {
  const attempts = await Promise.all(
    sources.map(async (source) => [source.source_id, await fetchSource(source, transport)] as const),
  );
  return new Map(attempts);
}
