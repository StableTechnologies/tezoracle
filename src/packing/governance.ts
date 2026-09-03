import { packMichelineWithType, type PackedPayload } from "./pack.js";
import {
  ASSET_INTENT_MICHELSON_TYPE,
  CONFIG_INTENT_MICHELSON_TYPE,
  INIT_MICHELSON_TYPE,
  SIMPLE_INTENT_MICHELSON_TYPE,
  assetIntentMicheline,
  configIntentMicheline,
  initMicheline,
  simpleIntentMicheline,
} from "./governance_michelson.js";
import {
  parseLogicalAssetIntent,
  parseLogicalConfigIntent,
  parseLogicalInit,
  parseLogicalSimpleIntent,
} from "./governance_validate.js";
import type { LogicalAssetIntent, LogicalConfigIntent, LogicalInit, LogicalSimpleIntent } from "./governance_types.js";

export function packInit(input: unknown): PackedPayload<LogicalInit> {
  const init = parseLogicalInit(input);
  return packMichelineWithType(init, initMicheline(init), INIT_MICHELSON_TYPE);
}

export function packConfigIntent(input: unknown): PackedPayload<LogicalConfigIntent> {
  const intent = parseLogicalConfigIntent(input);
  return packMichelineWithType(intent, configIntentMicheline(intent), CONFIG_INTENT_MICHELSON_TYPE);
}

export function packSimpleIntent(input: unknown): PackedPayload<LogicalSimpleIntent> {
  const intent = parseLogicalSimpleIntent(input);
  return packMichelineWithType(intent, simpleIntentMicheline(intent), SIMPLE_INTENT_MICHELSON_TYPE);
}

export function packAssetIntent(input: unknown): PackedPayload<LogicalAssetIntent> {
  const intent = parseLogicalAssetIntent(input);
  return packMichelineWithType(intent, assetIntentMicheline(intent), ASSET_INTENT_MICHELSON_TYPE);
}
