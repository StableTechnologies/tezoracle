# TezFin Resilient Oracle

## Engineering Response

**Date:** 14 August 2026  
**Status:** Design response and implementation baseline; not production approval

> Archived in `docs/` as the 14 August 2026 design record. The authorized TezOracle implementation phase is **testnet and non-authoritative shadow only**. Controlling repo docs are [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md), and [ROADMAP.md](ROADMAP.md). Upstream does **not** duplicate TezFin `configureMaxPriceAge` or `configurePriceBounds`; that boundary is [ORACLE_INTERFACE.md](ORACLE_INTERFACE.md).

## 1. Executive response

The specification is understood and accepted as the production security baseline. The earlier `OracleCexOnlyPlan.md` will be retained as an implementation inventory and cost baseline only.

The production design will be a permissionless, threshold-signed Michelson oracle with four separately administered signers in two independent validation classes. The initial quorum will be `3-of-4`, with at least one signature from each class. A single publisher is permitted only for testnet and non-authoritative mainnet shadow operation.

The intended integration is:

```text
Comptroller -> TezFinOracle -> ThresholdPriceOracle
```


## 2. Baseline and known repository discrepancy

The existing integration has these relevant constraints:

- `TezFinOracle.get_price_with_timestamp` calls the upstream view with `(nat price, timestamp)` and returns `(timestamp, nat)` to consumers.
- `Comptroller.updateAssetPricesWithView` consumes `TezFinOracle.getValidatedPrice` and retains consumer-side freshness, bounds, and movement checks.
- `Comptroller` configures `configureMaxPriceAge` and `configurePriceBounds` on its selected oracle.
- Governance changes the Comptroller oracle through `setPriceOracleAndTimeDiff`.
- Existing legacy symbols include forms such as `XTZUSDT`, `USDTUSDT`, `TZBTCUSDT`, and `*-USD` names.

The new oracle will therefore expose compatibility entrypoints or use a reviewed adapter. It will not rely on symbol-name inference.

## 3. Requirement response


### Accepted requirements

The following are accepted without a planned security deviation:

- production `3-of-4` threshold signatures;
- exactly two class-A and two class-B signers at initial activation;
- at least one signer from each validation class in every accepted quorum;
- permissionless submission and replaceable relayers;
- no requester- or coordinator-controlled source policy, price tolerance, decimals, or aggregation rule;
- canonical asset IDs and explicit compatibility aliases;
- observation timestamps distinct from Tezos inclusion timestamps;
- oldest-contributing-observation timestamp for derived prices;
- exact integer/fixed-point arithmetic;
- signed domain, chain ID, oracle address, configuration version, policy hash, group, round, validity window, asset entries, and evidence digest;
- independent core, USDtz, and tzBTC publication groups;
- non-zero activation delay and separate pending/active state;
- per-asset pause and fail-closed behavior;
- delayed, versioned signer, threshold, policy, bounds, alias, decimal, and asset changes;
- two-step administration and multisig final authority;
- external dead-man monitoring plus a second critical alert channel;
- reproducible builds, locked dependencies, artifact hashes, evidence records, and independent human security review;
- at least 30 consecutive days of shadow operation using the final production configuration.



### Deliberate deviations or clarifications

1. **Asset scope.** The production canonical set is `XTZ_USD`, `BTC_USD`, `USDT_USD`, `USDTZ_USD`, and `TZBTC_USD`. The earlier four-asset CEX plan is insufficient because it does not define the tzBTC peg risk.
2. **Compatibility API.** The threshold contract will provide `get_price_with_timestamp`, `configureMaxPriceAge`, and `configurePriceBounds` compatibility surfaces, or a separately reviewed adapter will provide them. This is required by the current TezFin wrapper and is not an authority shortcut.
3. **Publication atomicity.** Atomicity applies within an approved publication group, not across all assets. A failed USDtz or tzBTC derivation must not stop a healthy core update.
4. **Degraded DEX mode.** No one-pool USDtz degraded mode is enabled in the initial release. It may be added only through a delayed governance policy change and a new configuration version.
5. **tzBTC.** `TZBTC_USD` will remain non-authoritative for collateral and borrowing until a reviewed tzBTC/BTC peg policy and liquidity evidence exist. BTC/USD will not be used as an implicit tzBTC alias. The proposed initial policy is to publish tzBTC only as `BTC_USD * TZBTC_BTC_PEG`, where `TZBTC_BTC_PEG` is derived from approved Tezos liquidity routes using executable quotes, a rolling TWAP, minimum liquidity, bounded price impact, cross-route deviation, and the oldest contributing observation time. If those conditions are not met, the tzBTC group fails closed. No fixed peg, issuer assertion, or coordinator-selected haircut is accepted.
6. **AWS topology.** AWS Lambda/EventBridge is acceptable for each isolated signer domain and for non-authoritative services. A shared coordinator/relayer may not hold signing keys or become a policy authority.

## 4. Validator-class design


### Class A: venue-first market validator

Class A uses direct exchange adapters for Binance, OKX, Kraken, and Coinbase. It retrieves approved market paths, validates venue identity and timestamps, filters malformed or stale observations, applies the fixed source quorum and deviation policy, and calculates median-based prices using integer arithmetic. USDtz uses the approved Tezos DEX quote/TWAP path and USDT/USD. tzBTC is rejected unless the approved peg-factor route is available.

For DEX-derived assets, Class A reads the approved pool addresses and raw chain state directly through its configured RPC clients. It may use the same approved pools as Class B: the pools are shared market sources, while the validation implementations and observation retrieval are independent. Using different pools is optional and may reduce comparability if the pools have different liquidity or pricing conditions.

Two class-A signers run this implementation in separate administrative domains with separate Tezos keys, AWS accounts, IAM roles, secrets, logs, runtime deployments, and artifact hashes.

### Class B: independent route and validation implementation

Class B must not reuse Class A's critical acceptance function, policy parser, or compiled validation artifact. It will use a separate implementation language/module boundary and independently maintained parsers and arithmetic code. It may use the same approved source identities and golden vectors, but its source acquisition and validation decisions are independently computed.

The proposed implementation split is **TypeScript for Class A** and **Rust for Class B**. TypeScript matches the existing CEX publisher and AWS integration inventory. Rust provides a separate type system, parser implementation, arithmetic library, dependency graph, and runtime artifact for the security-critical Class-B path. This is a proposed engineering choice, not a claim that the specification mandates these exact languages.

The initial Class B design is:

- independent HTTP clients and schema decoders;
- independently implemented fixed-point decimal parser and median/deviation logic;
- independently maintained source-health and timestamp checks;
- independently maintained DEX quote/TWAP reconstruction from raw observations;
- independent canonical-price calculation;
- comparison against the proposed payload using a class-B fixed signer-deviation limit;
- a separate evidence record keyed by the final payload hash.

Class-B code may not receive a coordinator-provided price, source result, observation timestamp, tolerance, or policy override as authoritative input. It must retrieve or validate the underlying material locally.

Class B may read the same approved DEX pools as Class A, but it must use independently operated RPC access where practical, independently decode pool storage and operations, independently calculate executable quotes and TWAPs, and independently apply liquidity, impact, freshness, and cross-pool rules. The security boundary is the independent calculation and decision, not a requirement to invent a different market price by using unrelated pools.

Operationally, the coordinator first builds a proposal from the approved policy and sends the same proposal to all four signers. Each signer then independently obtains the observations, derives its local price, and either refuses or signs the complete payload. Class A and Class B do not vote on two pieces of one shared calculation: they independently answer whether the complete proposal is correct. The contract accepts only three unique signatures spanning both classes. Thus A1+A2+B1 can pass, but A1+A2+B2 is the same valid class-spanning quorum; A1+A2 alone and A1+B1 alone cannot pass.

### Isolation and quorum


| Signer | Class | Domain    | Key/runtime isolation                                  |
| ------ | ----- | --------- | ------------------------------------------------------ |
| A1     | A     | Account 1 | Separate root credentials, key, role, deployment, logs |
| A2     | A     | Account 2 | Separate root credentials, key, role, deployment, logs |
| B1     | B     | Account 3 | Independent implementation and administration          |
| B2     | B     | Account 4 | Independent implementation and administration          |


The contract counts unique active keys only. It requires three signatures and at least one from each class. Therefore, losing any one signer preserves liveness, while compromising any two signers cannot produce a quorum.

### Implementation languages

The on-chain contract will be authored in SmartPy/Python and compiled to Michelson. SmartPy is the source language for the contract; Tezos executes the resulting Michelson, so the production security boundary is the compiled Michelson artifact and its hash.

The proposed off-chain implementation is:

| Component | Proposed language | Reason |
| --- | --- | --- |
| Class A validator and CEX publisher | TypeScript on Node.js | Reuses the existing CEX adapter, AWS Lambda, HTTP, and deployment ecosystem |
| Class B validator | Rust | Provides an independently maintained parser, fixed-point arithmetic path, dependency graph, and compiled runtime artifact |
| Coordinator and permissionless relayer | TypeScript | Shares canonical payload, Tezos RPC, simulation, and submission tooling without holding signing authority |
| Contract tests and compile targets | SmartPy/Python | Matches the existing TezFin contract and test conventions |

The specification does not mandate TypeScript or Rust. It mandates independent security-critical implementations, separate administration, and no reuse of Class A's acceptance function, policy parser, or compiled validation artifact. Go could replace Rust, or another suitable language could be selected, but changing the proposed language split would require repeating the dependency, packing, arithmetic, signing, and artifact-independence review. The coordinator/relayer language does not create validator independence because it must not decide prices or hold signer keys.

## 5. Canonical payload proposal

The logical payload is:

```text
OraclePayload = {
  domain: bytes,
  chain_id: bytes,
  oracle_address: address,
  config_version: nat,
  policy_hash: bytes,
  publication_group: bytes,
  round: nat,
  valid_from: timestamp,
  valid_until: timestamp,
  evidence_digest: bytes,
  assets: list<AssetEntry>
}

AssetEntry = {
  asset_id: string,
  price: nat,
  decimals: nat,
  observation_time: timestamp
}
```

The Michelson representation will use a fixed nested pair/record layout with explicit field annotations. The canonical rules are:

- domain is `TEZFIN_ORACLE_V1`;
- asset entries are sorted by canonical ID;
- publication group determines the exact allowed asset set;
- all five asset IDs have fixed approved decimals, initially six for the TezFin compatibility price;
- no duplicate, unknown, missing, or alternative asset encoding is accepted;
- timestamps are Unix seconds and are checked against the chain time and policy age;
- `valid_until` is bounded by the active policy;
- `observation_time` is the oldest contributing observation for the derived value;
- signatures cover `PACK(OraclePayload)` exactly;
- `BLAKE2B(PACK(OraclePayload))` is the payload/evidence key, not a replacement for signatures.

The on-chain signature entry will bind each signature to a signer public key and the exact payload bytes. Duplicate keys, inactive keys, wrong classes, malformed signatures, and signatures from another configuration version do not count.

### Golden vectors

Before contract implementation, commit vectors containing:

1. the exact logical payload;
2. the expected Michelson value;
3. packed bytes in hexadecimal;
4. BLAKE2B digest;
5. one valid signature for each supported curve/encoding;
6. expected acceptance/rejection for tampered price, timestamp, round, chain ID, policy hash, and asset order.

The same vectors will be consumed by the SmartPy tests, both validator classes, the relayer, and the integration test against the compiled TezFin wrapper.

The golden-vector workflow is deterministic and runs before live source integration:

1. Create a fixed payload fixture with explicit field values, ordering, timestamps, asset decimals, and policy hash.
2. Serialize it using the proposed Michelson type and pack it with the Tezos `PACK` rules.
3. Record the packed hexadecimal bytes and `BLAKE2B` digest as expected outputs.
4. Sign the exact packed bytes with each supported signer key and record the signatures.
5. Verify the signatures and payload in the contract test, Class A library, Class B library, and relayer.
6. Mutate one field at a time, including price, asset order, decimals, round, chain ID, oracle address, policy hash, and validity window; every mutation must produce a different digest and fail signature or policy validation.
7. Re-run the same fixtures in CI and compare bytes, digests, signatures, and accept/reject results byte-for-byte.

Vectors are test fixtures, not production prices and not a source of market data. They prove that independently implemented components agree on the signed meaning and that no component silently signs a different serialization.

## 6. Implementation estimate

The estimate assumes reuse of the CEX adapter inventory, AWS publisher patterns, Tezos deployment tooling, TezFin wrapper, and existing SmartPy test conventions. Class A and the contract path can be developed in parallel with the Class B design after the payload boundary is frozen. The estimate covers an initial `3-of-4` implementation, not a future `4-of-5` or `5-of-7` expansion.


### Stage 1 - contract and deterministic test harness: 2 days

- implement `ThresholdPriceOracle` storage, signer classes, `3-of-4` threshold, and permissionless submission;
- implement signature, duplicate-signer, policy-hash, group, round, validity-window, and activation-delay checks;
- implement pending/active prices and per-asset pause state;
- add TezFin compatibility views and configuration entrypoints;
- add SmartPy tests for quorum, replay, timestamps, groups, pause, bounds, and same-level activation;
- generate the first canonical payload and golden-vector fixtures;
- compile and record the initial Michelson artifact hash.

### Stage 2 - Class A publisher and source validation: 2 days

- reuse and harden Binance, OKX, Kraken, and Coinbase adapters;
- implement schema, timestamp, source-quorum, median, deviation, and freshness checks;
- implement integer fixed-point normalization and USD derivation;
- implement approved USDtz DEX executable quotes, liquidity checks, and TWAP state;
- implement the initial tzBTC peg-factor interface in fail-closed mode;
- add source, arithmetic, DEX, TWAP, retry, idempotency, and malformed-response tests.

### Stage 3 - Coordinator proposal and relayer protocol: 1 day

- implement coordinator proposal creation, evidence digest, signing request, and relayer simulation;
- define the coordinator-to-signer proposal and evidence interface;
- ensure signers receive the same proposal but independently retrieve and validate source data;
- allow the primary coordinator to relay its own fully signed payload;
- provide a relayer interface that permits an independent backup relayer to submit the same payload without signing keys;
- add proposal tampering, missing-signature, simulation, retry, and duplicate-submission tests.

### Stage 4 - Class B independent validator: 3 days

- implement the Rust source clients and schema decoders independently from Class A;
- implement independent fixed-point parsing, median/deviation logic, timestamp checks, and overflow handling;
- independently decode the approved DEX storage/operations and reconstruct quotes and TWAPs;
- calculate the local canonical proposal and compare it with the coordinator payload;
- implement Class B evidence records, refusal codes, and signing decision;
- run disagreement, one-source-outage, bad-data, stale-data, and two-signer-compromise tests;
- produce the dependency and artifact report proving that Class B does not reuse Class A's critical acceptance code.

### Stage 5 - deployment and TezFin integration: 2 days

- configure four isolated signer domains, keys, secrets, roles, logs, and artifact references;
- configure the permissionless relayer and backup RPC path;
- add deployment, verification, and multisig handoff scripts;
- run TezFin wrapper and Comptroller integration tests for all publication groups;
- simulate oracle switching, legacy override removal, pause, recovery, and rollback;
- measure operation size, gas, fee, and latency for the initial `3-of-4` payload.

### Stage 6 - testnet and shadow launch support: 1 day plus 30 calendar days

- originate on testnet and verify initial storage and signer configuration;
- run publication, retry, duplicate, signer outage, class disagreement, DEX failure, and missed-heartbeat tests;
- compare accepted prices and timestamps with the independent monitor;
- complete 30 consecutive days using the final production configuration.

### Review, risks and bugfix

- Review : **5 hours**;
- Risks: **2 days**;
- Bugfix: **2 days**;

Based on the results of the work, a security audit should be conducted. Any fixes resulting from the security audit are not included in the estimate.

### Total estimate

The implementation work is estimated at  **15 days 5 hours**. The 30-day shadow period is calendar time and restarts after any material code, policy, signer, source, mapping, or configuration change. Production activation remains gated by the independent audit and governance approval.

## 7. Operating-cost estimate

These are planning ranges and must be replaced by provider quotes and measured chain fees before approval.

### Four isolated signer domains

- Four Lambda signer runtimes at 512 MB and up to 120 seconds per five-minute cycle: approximately `$6.3/month` total without relying on independent free-tier allowances; lower with available free tier.
- Four Secrets Manager secrets: approximately `$1.76/month`, excluding unusual KMS usage.
- Optional four customer-managed KMS keys: approximately `$4/month` plus requests. This requires a Tezos-compatible signing integration test before use.
- Four CloudWatch log groups and metrics: approximately `$2-8/month` depending on evidence volume and retention.
- Four small DynamoDB/TWAP or publication-state stores: approximately `$0.10-1/month` at this traffic level, subject to retention and reads.
- EventBridge scheduling and small cross-account coordination traffic: approximately `$0-5/month`.
- External dead-man switch and second alert channel: approximately `$0-20/month`, depending on Healthchecks plan and alert provider.
- Relayer infrastructure: approximately `$0-10/month` for a small backup runtime, excluding XTZ balance.

Planning total before chain fees is approximately `$15-55/month`. A conservative budget should use the upper range until actual logs, KMS choice, account billing, and alerting are finalized.

### Tezos fees

At 8,640 accepted publications per month:

```text
monthly fees = 8,640 * measured fee per publication
```

The earlier `OracleCexOnlyPlan.md` provides the correct initial fee baseline for the single-publisher design: `0.002 XTZ` per publication implies `17.28 XTZ/month`, `0.005 XTZ` implies `43.2 XTZ/month`, and `0.01 XTZ` implies `86.4 XTZ/month` at 8,640 publications per month. Those figures should be retained in the budget as the reference range. They are not yet the threshold-oracle forecast because `CHECK_SIGNATURE`, signer-set checks, larger payloads, and any group/configuration metadata may increase gas and operation fees. The threshold budget should therefore be reported as:

```text
threshold monthly fee = 8,640 * measured threshold fee per publication
```

Until testnet simulation is complete, the CEX-plan range of `17.28-86.4 XTZ/month` is the planning baseline, and the threshold implementation must be shown to fit within or update that range with measured data. Testnet measurements must record gas, fee, operation size, and failure behavior for the initial `3-of-4` configuration and the maximum supported future configuration.

### Operation byte limit and preliminary size model

The current Tezos mainnet constants observed from the live RPC are:

```text
max_operation_data_length     = 32,768 bytes (32 KiB)
hard_gas_limit_per_operation  = 1,040,000 gas units
hard_gas_limit_per_block      = 1,040,000 gas units
cost_per_byte                 = 250 mutez
```

`max_operation_data_length` is the maximum serialized data length accepted for one operation, including its shell and protocol-specific contents. The value is protocol-dependent and must be read again for the target network and protocol.

`cost_per_byte = 250 mutez` is a storage-allocation cost, not a universal transaction-byte fee and not a fixed gas price. Tezos does not expose one global `mutez per gas` price. The sender chooses an operation fee, and inclusion depends on the active payload producer's fee policy; gas consumption and the explicit fee must therefore be measured separately.

For a preliminary worst-case model, assume one publication group containing all five canonical assets:

```text
XTZ_USD, BTC_USD, USDT_USD, USDTZ_USD, TZBTC_USD
```

Raw CEX responses, DEX observations, and evidence records are not placed in the operation. The operation contains the derived asset prices, observation timestamps, policy/configuration metadata, and signatures. Using a fixed six-decimal price, Ed25519 signatures, and a full five-asset payload, use these conservative mock values:

```text
base manager operation and transaction fields  = 160 bytes
Michelson parameter/list overhead                = 25 bytes
canonical payload, five assets                  = 450 bytes
one signature entry with signer index            = 69 bytes
one signature entry with public key               = 105 bytes
```

The resulting preliminary sizes are:

| Configuration | Signatures | Signer indexes | Full public keys |
| --- | ---: | ---: | ---: |
| `3-of-4` | 3 | `160 + 25 + 450 + 3 * 69` = **842 bytes** | `160 + 25 + 450 + 3 * 105` = **950 bytes** |
| `4-of-5` | 4 | `160 + 25 + 450 + 4 * 69` = **911 bytes** | `160 + 25 + 450 + 4 * 105` = **1,055 bytes** |
| `5-of-7` | 5 | `160 + 25 + 450 + 5 * 69` = **980 bytes** | `160 + 25 + 450 + 5 * 105` = **1,160 bytes** |

With a 30% engineering margin, the `5-of-7` public-key estimate is approximately `1,508 bytes`, or about `1.5 KiB`. Against the current `32,768-byte` operation limit, that mock worst case uses approximately `4.6%` of the available operation data length. This does not prove inclusion: the exact forged operation, Micheline encoding, signature encoding, gas consumption, and baker fee policy still need to be tested.

The size grows approximately linearly with the number of included signatures:

```text
size(N) = fixed_operation_and_payload_size
          + N * signer_entry_size
```

The practical supported configuration is bounded by all relevant constraints:

```text
N_max = min(limit_by_operation_size, limit_by_operation_gas,
           limit_by_block_gas, limit_by_contract_design)
```

The dominant threshold constraint may be gas rather than bytes because each signature requires `CHECK_SIGNATURE`. The final benchmark must forge and simulate `3-of-4`, `4-of-5`, `5-of-7`, and the maximum proposed future configuration using the exact compiled contract and worst-case payload. It must record serialized bytes, gas consumed, explicit fee, storage diff, and inclusion result with a production margin.
