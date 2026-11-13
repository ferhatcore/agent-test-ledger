# Architecture

The CLI uses Node built-ins and a shared record format for terminals, Claude Code and Codex.

| Module | Responsibility |
| --- | --- |
| `ledger.mjs` | CLI arguments, key loading and exclusive output creation |
| `lib/ledger.mjs` | Command execution, output limits, snapshots and record verification |
| `lib/pytest.mjs` | Direct Python pytest recognition and bounded JUnit XML parsing |
| `lib/runners.mjs` | Recognition and parsing of direct Jest/Vitest JSON reports |
| `lib/client-context.mjs` | Bounded hook input, environment marker observations and strict observation validation |
| `lib/files.mjs` | Relative paths, root containment, file exclusions and bounded reads |
| `lib/report.mjs` | Escaped, self-contained HTML reports |
| `receipt.mjs` | Upstream canonical hashing, Ed25519 operations and legacy commands |

Process outcome, test outcome and file freshness are separate. A failed command can produce a valid record, and a passing record can later become stale. Without tracked artifacts, freshness is untracked.

Node TAP counts come from stdout. Jest/Vitest counts come from the explicit JSON destination, which must be newly created or contain different bytes after execution. Verification checks the recorded command/report linkage and listed artifact hashes; it never executes the command.

Client labels are user supplied. Separate client observations capture only an exact environment marker and optional hook fingerprints before execution; they never authenticate a client. Schema 2 requires observations, while schema-1 records retain their previous verification behavior. File snapshots cover persistent before/after changes, not edits reverted during execution. Local filesystem races, forged runner output and guaranteed descendant termination are outside the tool's guarantees.
