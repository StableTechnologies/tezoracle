/**
 * Canonical payload packing placeholder.
 *
 * Implementations must not silently reorder or normalize fields. Byte-for-byte
 * SmartPy vs TypeScript parity is required before any signing path.
 */
export const PACKING_STATUS = "unfrozen" as const;
