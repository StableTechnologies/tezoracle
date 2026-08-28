# Roadmap

Authorized work is the **initial 56-hour phase**: public repository, frozen payload/evidence/policy, N-of-M Michelson contract, TypeScript Class A, coordinator/relayer, and local testnet/shadow only.

Anything not listed under initial scope requires **separate approval**. Passing CI, a testnet origination, or a shadow publication is not production approval.

## Initial phase (authorized)

| Workstream | Outcome |
| --- | --- |
| Repository, docs, CI | Public baseline, Apache-2.0, no secrets, passing skeleton CI |
| Payload, evidence, observer agreement, parameter register | Frozen specs; USDT, XTZ, BTC as draft/testnet; USDtz and tzBTC non-authoritative stubs |
| Packing and golden vectors | SmartPy and TypeScript byte-for-byte; frozen in `tests/packing/vectors/` |
| N-of-M contract | Configurable `N`, `M`, class minima; pending/active; delayed unpause/governance; view `(nat, timestamp)` |
| TezFin boundary docs | Upstream price + observation time; aliases/age/bounds remain in TezFin |
| Class A | Adapter interface, four CEX adapters (Binance, OKX, Kraken, Coinbase), derivation, candidate verify, testnet signing |
| Coordinator and relayer | Non-authoritative coordinator; permissionless relayer with no keys |
| Local e2e | 1-of-1 observe → derive → sign → simulate/submit → read view, plus negative cases |
| Scope gate | Clean CI, no secrets, stop |

**Stretch inside remaining hours (not a silent expansion):** live testnet origination, DEX TWAP, 5-of-7 gas/size benches. CEX adapters are not stretch.

**Must not happen in this phase:** production activation, Rust Class B, four signer environments, production 3-of-4, TezFin `set_oracle`.

## Execution order

Evidence, observer agreement, and the parameter register freeze **with the payload**, before the contract and before any signing path.

1. Repository foundation (this baseline)
2. Freeze `PAYLOAD_SPEC`, `EVIDENCE_SPEC`, `OBSERVER_AGREEMENT`, `PARAMETER_SCHEMA` and config stubs
3. Packing parity and golden vectors
4. Configurable N-of-M SmartPy contract and harness
5. `ORACLE_INTERFACE.md` TezFin boundary
6. Class A TypeScript validator (may overlap with the contract after packing is frozen)
7. Coordinator and permissionless relayer
8. Local e2e (live origination is stretch)
9. Scope gate and stop

## Production phase (not authorized)

These items are recorded so they are not silently pulled into the initial phase:

- Independent Rust Class B validator
- Proof that Class A and Class B artifacts and operations are independent
- Four separated signer environments: A1, A2, B1, B2
- Production 3-of-4 with class minima (at least one signature from each class)
- DEX TWAP if not finished as stretch
- 30 consecutive days of shadow evidence on the frozen production configuration
- Independent external security audit with no unresolved critical/high findings
- TezFin governance approval of oracle address, asset policies, and market activation
- Authoritative USDtz and tzBTC policies after liquidity and peg review

## Lifecycle of configuration

Asset and policy rows in `config/` use explicit lifecycle states: `draft`, `testnet`, `shadow`, `production`. A row marked `production` in a file is not permission to activate TezFin markets. Activation delay applies to policy changes. USDtz and tzBTC remain non-authoritative until separately reviewed.

## Done when

The initial phase is done when:

- CI passes from a clean checkout with no secrets
- Payload vectors are immutable review artifacts
- The contract is N-of-M, not 3-of-4-specific
- Coordinator and relayer have no signing keys
- No TezFin-specific consumer code was added here
- The running system is testnet / non-authoritative shadow only
- Incomplete work is listed under the production phase

Then **stop** and wait for a separate production authorization.
