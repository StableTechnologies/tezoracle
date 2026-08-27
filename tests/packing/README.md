# Packing golden vectors — immutable review artifacts.
#
# Logical payload, Micheline, packed hex, and BLAKE2B-256 live in vectors/.
# Quorum-shared evidence manifests live in evidence/. policy_hash is
# BLAKE2B-256 of config/ (canonical JSON). evidence_digest is BLAKE2B-256
# of the corresponding manifest. Tests and scripts/recompute-vector-hashes.ts
# fail if those hashes or the packed bytes diverge.
# Test-only ed25519 keys and signatures live in keys/ and are not production
# material. Rust Class B must match these bytes later; it is not this phase.
#
# Regenerate with: npx tsx scripts/freeze-packing-vectors.ts
# Then re-run TypeScript and SmartPy packing tests. Do not hand-edit hex.
