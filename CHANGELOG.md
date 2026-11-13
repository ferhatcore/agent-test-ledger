# Changelog

## 0.9.1

- Record commands, process outcomes, test counts and file freshness in separate fields.
- Parse Node TAP and JSON reports from direct Jest/Vitest invocations.
- Reject empty test files as current passing evidence.
- Bound command output and execution time, and check artifact paths against the project root.
- Support optional Ed25519 signatures and escaped, offline HTML reports.
- Include CLI guides, examples and regression tests.
- Update installation documentation and package metadata.

## Roadmap

- Additional runner adapters, including pytest, with fixture coverage.
- Authenticated client provenance where it can be measured reliably.
- Platform-specific process-tree management.
