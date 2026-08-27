import { ValidatorError } from "../errors.js";
import type { RefusalCode } from "../errors.js";

export const CLASS_A_USER_AGENT =
  "TezOracle-ClassA/0.0.0 (non-production; +https://github.com/StableTechnologies/TezOracle)";

export type HttpRequest = {
  url: string;
  method: "GET";
  timeout_ms: number;
  max_response_bytes: number;
  headers?: Record<string, string>;
};

export type HttpResponse = {
  status: number;
  body: string;
  contentType: string;
  finalUrl: string;
};

export type HttpTransport = (request: HttpRequest) => Promise<HttpResponse>;

export class HttpError extends Error {
  readonly code: Extract<RefusalCode, "TIMEOUT" | "MALFORMED" | "OVERSIZE">;

  constructor(code: Extract<RefusalCode, "TIMEOUT" | "MALFORMED" | "OVERSIZE">, message: string) {
    super(message);
    this.name = "HttpError";
    this.code = code;
  }
}

export function sourceUrl(endpoint: string, query: string): string {
  return query.length > 0 ? `${endpoint}?${query}` : endpoint;
}

export function hostsMatch(left: string, right: string): boolean {
  return new URL(left).host === new URL(right).host;
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) {
    throw new HttpError("OVERSIZE", "content-length exceeds max_response_bytes");
  }
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new HttpError("OVERSIZE", "response exceeds max_response_bytes");
      }
      chunks.push(value);
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export async function defaultHttpTransport(request: HttpRequest): Promise<HttpResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), request.timeout_ms);
  try {
    const response = await fetch(request.url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "user-agent": CLASS_A_USER_AGENT,
        ...request.headers,
      },
    });
    const finalUrl = response.url || request.url;
    if (!hostsMatch(finalUrl, request.url)) {
      throw new HttpError("MALFORMED", "redirect changed host");
    }
    const body = await readCapped(response, request.max_response_bytes);
    return {
      status: response.status,
      body,
      contentType: response.headers.get("content-type") ?? "",
      finalUrl,
    };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof ValidatorError) throw error;
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new HttpError("TIMEOUT", "bounded HTTP timeout");
    }
    throw new HttpError("TIMEOUT", "source unavailable");
  } finally {
    clearTimeout(timer);
  }
}

export type MockFixture = {
  status?: number;
  body: unknown;
  contentType?: string;
  finalUrl?: string;
  error?: "TIMEOUT" | "MALFORMED" | "OVERSIZE";
};

export function createMockTransport(fixtures: Record<string, MockFixture>): HttpTransport {
  return async (request) => {
    const fixture = fixtures[request.url];
    if (!fixture) {
      throw new HttpError("MALFORMED", `no fixture for ${request.url}`);
    }
    if (fixture.error) {
      throw new HttpError(fixture.error, fixture.error);
    }
    const body = typeof fixture.body === "string" ? fixture.body : JSON.stringify(fixture.body);
    if (new TextEncoder().encode(body).byteLength > request.max_response_bytes) {
      throw new HttpError("OVERSIZE", "fixture exceeds max_response_bytes");
    }
    return {
      status: fixture.status ?? 200,
      body,
      contentType: fixture.contentType ?? "application/json",
      finalUrl: fixture.finalUrl ?? request.url,
    };
  };
}

export function loadFixtureMap(raw: unknown): Record<string, MockFixture> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ValidatorError("MALFORMED", "fixture map must be an object");
  }
  const out: Record<string, MockFixture> = {};
  for (const [url, value] of Object.entries(raw)) {
    if (typeof value !== "object" || value === null || Array.isArray(value) || !("body" in value)) {
      throw new ValidatorError("MALFORMED", `fixture ${url} must have a body`);
    }
    out[url] = value as MockFixture;
  }
  return out;
}
