import { type AssetEntry, type LogicalPayload, type Micheline } from "./types.js";

const annot = (name: string): string[] => [`%${name}`];

export const ASSET_ENTRY_TYPE: Micheline = {
  prim: "pair",
  args: [
    { prim: "string", annots: annot("asset_id") },
    {
      prim: "pair",
      args: [
        { prim: "nat", annots: annot("price") },
        {
          prim: "pair",
          args: [
            { prim: "nat", annots: annot("decimals") },
            { prim: "timestamp", annots: annot("observation_time") },
          ],
        },
      ],
    },
  ],
};

export const PAYLOAD_MICHELSON_TYPE: Micheline = {
  prim: "pair",
  args: [
    { prim: "string", annots: annot("domain") },
    {
      prim: "pair",
      args: [
        { prim: "chain_id", annots: annot("chain_id") },
        {
          prim: "pair",
          args: [
            { prim: "address", annots: annot("oracle_address") },
            {
              prim: "pair",
              args: [
                { prim: "nat", annots: annot("config_version") },
                {
                  prim: "pair",
                  args: [
                    { prim: "bytes", annots: annot("policy_hash") },
                    {
                      prim: "pair",
                      args: [
                        { prim: "string", annots: annot("publication_group") },
                        {
                          prim: "pair",
                          args: [
                            { prim: "nat", annots: annot("round") },
                            {
                              prim: "pair",
                              args: [
                                { prim: "timestamp", annots: annot("valid_from") },
                                {
                                  prim: "pair",
                                  args: [
                                    { prim: "timestamp", annots: annot("valid_until") },
                                    {
                                      prim: "pair",
                                      args: [
                                        { prim: "bytes", annots: annot("evidence_digest") },
                                        {
                                          prim: "list",
                                          annots: annot("assets"),
                                          args: [ASSET_ENTRY_TYPE],
                                        },
                                      ],
                                    },
                                  ],
                                },
                              ],
                            },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

function pair(left: Micheline, right: Micheline): Micheline {
  return { prim: "Pair", args: [left, right] };
}

function assetMicheline(asset: AssetEntry): Micheline {
  return pair(
    { string: asset.asset_id },
    pair(
      { int: asset.price },
      pair({ int: asset.decimals }, { int: asset.observation_time }),
    ),
  );
}

export function payloadMicheline(payload: LogicalPayload): Micheline {
  const assets: Micheline = payload.assets.map(assetMicheline);
  return pair(
    { string: payload.domain },
    pair(
      { string: payload.chain_id },
      pair(
        { string: payload.oracle_address },
        pair(
          { int: payload.config_version },
          pair(
            { bytes: payload.policy_hash },
            pair(
              { string: payload.publication_group },
              pair(
                { int: payload.round },
                pair(
                  { int: payload.valid_from },
                  pair(
                    { int: payload.valid_until },
                    pair({ bytes: payload.evidence_digest }, assets),
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

export { ASSET_ENTRY_TYPE as ASSET_MICHELSON_TYPE };
