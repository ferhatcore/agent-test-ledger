# Provenance

Agent Test Ledger is based on [Kayforkind/agent-receipts](https://github.com/Kayforkind/agent-receipts).

| Source detail | Value |
| --- | --- |
| Retrieved | 2026-11-11 UTC |
| Commit | `9220edcf66ca3513b37aac7c10a9d36e60896e0b` |
| Commit date | `2026-10-09T23:38:28-05:00` |
| Package | agent-receipts 0.2.2 |
| Legacy schemas | 0.2, with 0.1 verification support |
| License | MIT, Copyright (c) 2026 NavigatorsLab |

The full license and original copyright remain in LICENSE. New contributions are Copyright (c) 2026 Ferhat Kosger. The project started from an independent source copy exported from the pinned commit; upstream Git metadata was not included.

## Reused code

`receipt.mjs` and `receipt.test.mjs` derive from upstream. All 17 original tests are retained. Canonical JSON, self-hashes, key generation and Ed25519 signing/verification reuse the upstream implementation.

Changes to `receipt.mjs` export `signatureProblem` for reuse, reject empty verification keys, add clear signing-key errors, validate legacy signing keys before running checks, and reject private-key material supplied as a public key.

## Added functionality

`ledger.mjs` and `lib/` add command recording, separate process/test/file states, bounded output hashes, pre/post artifact snapshots, Node TAP and Jest/Vitest report parsing, explicit client-label provenance and offline HTML reports. The repository also adds regression tests, examples and client guides. The pinned Windows/Linux workflow runs both upstream and ledger tests.

See [validation results](validation/RESULTS.md) for the current regression and package checks.

[Project OS](https://github.com/ferhatcore/claude-codex-project-os) supplied task/QA conventions as a reference. Its files were not copied into this project. The [Project OS guide](docs/project-os.md) contains illustrative record references, not a tested native integration.
