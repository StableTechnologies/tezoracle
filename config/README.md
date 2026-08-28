# Asset and policy configuration

Version-controlled parameter register for TezOracle.

**Status:** frozen for the initial phase. Testnet and non-authoritative only.
USDtz and tzBTC are draft stubs and are not consumable.

| Path | Role |
| --- | --- |
| [`schema.json`](schema.json) | JSON Schema for the assembled snapshot |
| [`register.json`](register.json) | System-level domain, groups, time policy, governance, signer environments |
| [`assets/USDT_USD.json`](assets/USDT_USD.json) | USDt/USD, testnet |
| [`assets/XTZ_USD.json`](assets/XTZ_USD.json) | XTZ/USD, testnet |
| [`assets/BTC_USD.json`](assets/BTC_USD.json) | BTC/USD, testnet |
| [`assets/USDTZ_USD.json`](assets/USDTZ_USD.json) | USDtz/USD, non-authoritative stub |
| [`assets/TZBTC_USD.json`](assets/TZBTC_USD.json) | tzBTC/USD, non-authoritative stub |

Human-readable rules: [`docs/PARAMETER_SCHEMA.md`](../docs/PARAMETER_SCHEMA.md).
Policy is never taken from a coordinator request. Unknown fields are rejected.

No production credentials or private endpoints belong here. Public CEX REST
paths are source identity, not secrets.
