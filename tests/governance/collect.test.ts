import assert from "node:assert/strict";
import test from "node:test";

import {
  assembleGovernanceCall,
  collectGovernanceSignature,
  openGovernanceCollection,
} from "../../src/governance/collect.js";
import { packSimpleIntent } from "../../src/packing/governance.js";
import { loadCommittedRegister } from "../../src/config/policy.js";
import { signGovernanceArtifact } from "../../src/validator/governance.js";
import {
  CHAIN_ID,
  CONFIG_DIR,
  NOW,
  ORACLE_ADDRESS,
  TRANSPORT_SIGNERS,
  signerSet3of4,
} from "../transport/helpers.js";

function artifact() {
  const intent = {
    domain: "TEZORACLE_UNPAUSE_V1" as const,
    chain_id: CHAIN_ID,
    oracle_address: ORACLE_ADDRESS,
    current_config_version: "3",
    governance_nonce: "9",
    valid_until: String(NOW + 600),
  };
  return { intent, packed_hex: packSimpleIntent(intent).packedHex };
}

test("governance collector requires M-of-M even when price threshold is 3-of-4", async () => {
  const frozen = artifact();
  const { snapshot } = loadCommittedRegister(CONFIG_DIR);
  let state = openGovernanceCollection({
    artifact: frozen,
    signerSet: signerSet3of4(),
    collectUntil: String(NOW + 300),
  });
  for (const signer of TRANSPORT_SIGNERS) {
    const signed = await signGovernanceArtifact({
      artifact: frozen,
      snapshot,
      secretKey: signer.secret_key,
      now: NOW,
    });
    state = collectGovernanceSignature(
      state,
      {
        index: signer.index,
        public_key: signed.public_key,
        signature: signed.signature.edsig,
        packed_hex: signed.packed_hex,
      },
      NOW,
    );
    if (state.signatures.length < 4) assert.equal(state.status, "open");
  }
  assert.equal(state.status, "quorum");
  const call = assembleGovernanceCall(state, NOW);
  assert.equal(call.packed_hex, frozen.packed_hex);
  assert.equal(call.signatures.length, 4);
});

test("governance collector rejects duplicate and mismatched bytes", async () => {
  const frozen = artifact();
  const { snapshot } = loadCommittedRegister(CONFIG_DIR);
  const signer = TRANSPORT_SIGNERS[0]!;
  const signed = await signGovernanceArtifact({
    artifact: frozen,
    snapshot,
    secretKey: signer.secret_key,
    now: NOW,
  });
  const incoming = {
    index: signer.index,
    public_key: signed.public_key,
    signature: signed.signature.edsig,
    packed_hex: signed.packed_hex,
  };
  const opened = openGovernanceCollection({
    artifact: frozen,
    signerSet: signerSet3of4(),
    collectUntil: String(NOW + 300),
  });
  const once = collectGovernanceSignature(opened, incoming, NOW);
  assert.throws(() => collectGovernanceSignature(once, incoming, NOW), /DUPLICATE/);
  assert.throws(
    () =>
      collectGovernanceSignature(
        opened,
        { ...incoming, packed_hex: `05${"00".repeat(8)}` },
        NOW,
      ),
    /PACKED_MISMATCH/,
  );
});
