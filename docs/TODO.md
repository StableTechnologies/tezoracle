# TODO

## Production governance signer isolation

- [ ] Replace the single-account 1-of-1 testnet reference stack with four
  independently administered signer domains (A1, A2, B1, B2).
- [ ] Give each domain its own AWS account or equivalent trust boundary,
  deployment pipeline, IAM role, Secrets Manager secret, governance
  intent/sidecar pin, deployment identity, and manual invocation path.
- [ ] Keep the governance collector shared and keyless.
- [ ] Verify operationally that no one AWS administrator or deployment
  principal can replace or invoke more than one signer domain.

Until this is complete, the repository's AWS stack is testnet/shadow only and
must not be described as an independently controlled production 4-of-4.
