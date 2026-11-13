# Legacy migration

`node receipt.mjs keygen|make|verify` and the agent-receipts bin retain the legacy command format and all 17 original tests. Key handling has been tightened: an explicitly supplied empty public key fails verification, private PEMs are rejected as public keys, and signing keys are validated before checks run. Supply a valid Ed25519 public PEM with `--pubkey`, or omit it for consistency-only verification. Schema 0.1/0.2 stays with the legacy verifier; the new verifier requires the ledger schema.

Replace shell-based `make --check "tests=node --test ..."` with `node ledger.mjs run --task "..." --artifact path/to/source -- node --test --test-reporter=tap path/to/test.mjs`. Choose a fresh output or omit out for a UUID. Artifacts must already exist for pre-run snapshots.

Legacy make calls checks passed based on exit codes and intentionally uses shell execution. New run executes a literal argument vector and separately classifies tests. Legacy verify returns nonzero for failed checks; new verify can return zero for a consistent failed-test record. Read currentTestEvidence and tests.status for a QA gate.

Canonical hashing, Ed25519 keys and signatures are reused. Legacy defaults remain 10 minutes and 64 MiB captured output. New defaults are 5 minutes and 1 MiB combined capture. Private keys are never distributed in examples.
