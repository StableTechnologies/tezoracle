export function unwrapEvent(event: unknown): Record<string, unknown> {
  if (typeof event !== "object" || event === null || Array.isArray(event)) return {};
  const body = (event as { body?: unknown }).body;
  if (typeof body === "string" && body.length > 0) {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  }
  if (typeof body === "object" && body !== null && !Array.isArray(body)) {
    return body as Record<string, unknown>;
  }
  return event as Record<string, unknown>;
}

export function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}
