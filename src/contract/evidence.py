from contract.canonical import blake2b256_utf8, canonical_json


def hash_shared_manifest(manifest: dict) -> str:
    return blake2b256_utf8(canonical_json(manifest))
