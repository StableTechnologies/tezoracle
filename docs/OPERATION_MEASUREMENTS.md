# Encoded operation size and gas

Measured with `octez-client --mode mockup` against protocol **Ushuaia** (`PsUshuai9QapM5TGj1JpuVGkdxz5GykdnEvS6Rh8SUVrARvZLCY`).
Bootstrap and generated keys only. Not a live-network origination.

Michelson **text** size is not the encoded origination size. Ushuaia `max_operation_data_length` is 32768 bytes.

- octez-client: `Octez 25.0`
- mockup chain_id: `NetXynUjJNZm7wi`
- Michelson **text** size: 116341 bytes
- encoded **script** size: 19897 bytes
- `max_operation_data_length`: 32768
- `hard_gas_limit_per_operation`: 1040000
- maximum tested publication-group size: 8

| Operation | Encoded op (bytes) | Gas | Storage burn (bytes) | Storage size | Fee (ꜩ) | Burn (ꜩ) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| originate:tezoracle_3of4 | 21052 | 11367 | 20570 | 20570 | 0.022363 | 5.20675 |
| submit:tezoracle_3of4 | 703 | 8336 | 73 | 20643 | 0.001721 | 0.01825 |
| originate:tezoracle_5of7 | 21257 | 11625 | 20712 | 20712 | 0.022594 | 5.24225 |
| submit:tezoracle_5of7 | 919 | 8734 | 73 | 20785 | 0.001977 | 0.01825 |
| originate:tezoracle_5of7_maxgroup | 21538 | 11664 | 20885 | 20885 | 0.022879 | 5.2855 |
| submit:tezoracle_5of7_maxgroup | 1037 | 8833 | 164 | 21049 | 0.002105 | 0.041 |

Re-run: `PYTHONPATH=src python scripts/measure_octez_ops.py`.
