# Security policy

This local CLI is not a sandbox or a public service. Use Node.js >=22. Commands run with the caller's permissions and environment and can access that user's credentials. The ledger itself neither discovers credentials nor calls AI APIs.

- Only `run` and legacy `make` execute explicitly supplied commands. New `run` uses `shell: false`; legacy `make` intentionally uses a shell. `verify` and `report` never execute record contents.
- Default tree scope performs bounded cleanup of the Linux process group or Windows Job Object, including normal descendants after root exit. Direct scope controls only the immediate child. Other sessions, brokers or services can escape these boundaries; failed/unconfirmed cleanup blocks current passing evidence. Use an external OS sandbox for adversarial workloads. See [process control](docs/process-control.md).
- Combined output capture defaults to 1 MiB, maximum 16 MiB. Interrupted hashes cover captured prefixes. Raw output is not persisted. Command arguments and task descriptions are persisted verbatim and must not contain secrets.
- Receipt reads are limited to 1 MiB and 24 nesting levels. At most 128 artifacts are explicitly selected; each must be a regular file at most 64 MiB. Normalized relative paths, realpath containment and secret exclusions reject traversal, drive paths, escaping symlinks/junctions and aliases to secret-looking targets. Recognizable private-key contents are excluded too. These checks do not guarantee complete secret detection.
- File snapshots detect persistent before/after changes, not reverted intermediate changes. Only listed files are checked. No artifacts means `untracked` freshness. Realpath checks cannot prevent concurrent adversarial filesystem races; they are not OS isolation.
- Outputs use exclusive creation and mode 0600. Existing outputs are not silently overwritten. Windows account ACLs must be protected separately. Use private parent directories; concurrent parent-directory replacement is outside the threat model.
- Self-hashes check consistency, not authenticity. Optional Ed25519 signatures require a public key obtained through a trusted channel, and prove key possession rather than truthful execution. Without `--pubkey`, signatures are not cryptographically checked.
- A malicious command can forge Node TAP output, a Jest/Vitest JSON report or pytest JUnit XML. All client labels are supplied by the caller. Schema-2 environment and hook observations are forgeable and do not authenticate client origin or interface; private hook fields are excluded from the record. See [client context](docs/client-context.md).
- Reports escape untrusted data, contain no scripts or remote assets, and use a restrictive Content Security Policy. Metadata can still be sensitive. Static reports do not refresh file hashes when opened.

## Reporting a vulnerability

Report vulnerabilities privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability** (GitHub private vulnerability reporting). Do not open a public issue, pull request or discussion for a suspected vulnerability. Include the affected version or commit, reproduction steps and expected versus actual behaviour.

This is an independently maintained project. Reports are handled on a best-effort basis; no response SLA or security certification is offered. Do not publish secrets or private records in issues.

Upstream security controls and all regression tests remain in `receipt.mjs` / `receipt.test.mjs`. See `docs/migration.md` for legacy shell, limits and verification semantics. This policy replaces unrelated upstream boilerplate about other tools.
