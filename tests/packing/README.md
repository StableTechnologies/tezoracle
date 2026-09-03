# Packing golden vectors — immutable review artifacts.
#
# Logical payload, Micheline, packed hex, and BLAKE2B-256 live in vectors/.
# Quorum-shared evidence manifests live in evidence/. policy_hash is
# BLAKE2B-256 of config/ (canonical JSON). evidence_digest is BLAKE2B-256
# of the corresponding manifest. Tests and scripts/recompute-vector-hashes.ts
# fail if those hashes or the packed bytes diverge.
# Governance intents: tests/packing/governance/GI-*.json from SmartPy PACK
#   PYTHONPATH=src python scripts/freeze-governance-vectors.py
# Test-only ed25519 keys and signatures live in keys/ and are not production
# material. The committed edsk is a synthetic CHECK_SIGNATURE fixture; it has
# never been funded and must not be reused on a network with value.
# Rust Class B must match these bytes later; it is not this phase.
#
# Regenerate with: npx tsx scripts/freeze-packing-vectors.ts
# Then re-run TypeScript and SmartPy packing tests. Do not hand-edit hex.
