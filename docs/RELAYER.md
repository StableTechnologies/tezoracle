# Relayer

**Status:** implemented for the initial TezOracle phase.  
**Authority:** permissionless. Anyone may submit a valid signed batch.  
**Keys:** no oracle signing keys. The relayer cannot create a signature that counts toward `N`.

The relayer transports already-signed bytes to `submit`. It verifies signatures locally, simulates the contract call, broadcasts, and confirms inclusion. It must not modify `PACK(payload)`. A backup relayer submits the **same** sealed batch if the primary path is down. The coordinator is optional for this path.

## 1. Boundaries

| May do | Must not do |
| --- | --- |
| Parse a `TEZORACLE_SIGNED_BATCH_V1` document | Hold an oracle `edsk`, mnemonic, or `TEZORACLE_SIGNER_SECRET_KEY` |
| Recompute `PACK(payload)` and require byte-for-byte equality with `packed_hex` | Reorder, renormalize, or replace payload fields |
| Locally `CHECK_SIGNATURE` every submitted index | Skip a bad signature or count an unknown/inactive signer |
| Simulate, broadcast, and confirm via an injected RPC | Submit after a failed simulation |
| Submit a batch assembled without a coordinator | Ask a coordinator for a new price when the coordinator is down |

A later fee-paying Tezos account used only to inject the operation is not an oracle signer and must not appear in the signer set. This phase’s CI path uses a mock RPC. Local e2e (`tests/e2e/local.test.ts`) injects an in-memory contract harness as `RelayRpc`. Live Ghostnet injection remains stretch.

## 2. Signed batch

The portable document is:

```text
{
  domain: TEZORACLE_SIGNED_BATCH_V1,
  payload: LogicalPayload,
  packed_hex: 0x05-prefixed hex,
  signatures: [{ index, public_key, signature }]
}
```

`payload` is the frozen type in [PAYLOAD_SPEC.md](PAYLOAD_SPEC.md). `packed_hex` is `PACK(payload)` from `src/packing`. Signatures are Tezos `edsig`/`sig` strings over those bytes. Evidence is not part of the on-chain parameter.

The `submit` Micheline is:

```text
Pair <payload> [ Pair <index> <signature>, ... ]
```

matching [CONTRACT_SPEC.md](CONTRACT_SPEC.md) §3. Signature-list order is not signed; the relayer sorts by index only to encode a stable parameter. It never changes `packed_hex`.

## 3. Local verify

Before any RPC call the relayer:

1. Rejects secret-shaped fields (`HOLD_KEYS`).
2. Parses the batch with no unknown fields.
3. Requires `PACK(payload) === packed_hex` (`PACKED_MISMATCH` if a byte differs).
4. Rejects unknown, duplicate, and inactive signer indices.
5. Requires each `public_key` to match the configured set at that index.
6. Verifies `CHECK_SIGNATURE` over `packed_hex`.
7. Requires at least `N` unique valid signatures and every configured class minimum.

`N`/`M` and class minima are signer-set configuration, not market-data policy. `1-of-1` and `3-of-4` are both valid configs of the same code. Insufficient quorum is fail-closed.

## 4. Simulate, broadcast, confirm

`relaySignedBatch`:

```text
verify → simulate → broadcast → confirm
```

A failed simulation does not broadcast. A failed broadcast does not confirm. Retry of a transient RPC is the adapter’s concern; this module does not invent a “publish anyway” after `SIMULATE`.

The RPC is an injected `RelayRpc`. Tests use `createMockRpc` / `createFailingSimulateRpc`. `createHttpRelayRpc` is a placeholder: this repository does not embed a production RPC URL.

## 5. Backup path

The sealed batch does not depend on the coordinator remaining up.

```text
primary.relay(batch)  --fail-->  backup.relay(same batch)
```

Both paths must submit the same `packed_hex`. The backup relayer has no signing keys and does not re-derive a price. If the batch is invalid, both paths refuse.

## 6. CLI

```bash
npm run relayer -- verify --batch file --signers file
npm run relayer -- encode --batch file --signers file
npm run relayer -- submit --batch file --signers file
```

`submit` requires an injected `RelayRpc` (tests and local e2e). `encode` prints the immutable `submit` parameter for an external injector such as `octez-client`.

The relayer never reads `TEZORACLE_SIGNER_SECRET_KEY`. A later fee-payer secret is not an oracle signer.

AWS testnet/shadow transport (`relayerBackup` is a second function on the same sealed batch): [AWS_DEPLOY.md](AWS_DEPLOY.md).

## 7. Failure codes

| Code | Meaning |
| --- | --- |
| `PACKED_MISMATCH` | `packed_hex` is not `PACK(payload)` |
| `SIGNATURE` | Local `CHECK_SIGNATURE` failed, or public key disagrees with the set |
| `QUORUM` | Fewer than `N` signatures, or more than 16 |
| `DUPLICATE` / `UNKNOWN_SIGNER` / `INACTIVE_SIGNER` | Signer-set checks |
| `CLASS_MIN` | A configured class minimum was not met |
| `SIMULATE` / `BROADCAST` / `CONFIRM` | Injected RPC step failed |
| `HOLD_KEYS` | Secret-shaped material appeared in the batch or signer set |
| `INTERNAL` | Malformed input, unknown command, or missing RPC |

## 8. Out of scope

- Production keys, endpoints, or TezFin `set_oracle`
- Mutating signed bytes to “fix” a simulation error
- Becoming the price or policy authority when the coordinator is down
