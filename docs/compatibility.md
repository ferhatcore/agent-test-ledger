# Compatibility

Agent Test Ledger requires Node.js 22 or later and uses no runtime dependencies.

## Test runners

| Runner | Invocation | Result source |
| --- | --- | --- |
| Node `node:test` | `node --test --test-reporter=tap` | TAP summary on stdout |
| Jest | `node node_modules/jest/bin/jest.js --json --outputFile=FILE` | JSON report file |
| pytest | `python -m pytest --junit-xml=FILE` | Built-in JUnit XML report |
| Vitest | `node node_modules/vitest/vitest.mjs run --reporter=json --outputFile=FILE` | JSON report file |

Jest 30.5.2, Vitest 5.1.0 and pytest 9.2.0 on Python 3.13 are used in the compatibility checks. The runner must be installed in the project being tested. npm/shell wrappers and other runners retain process results with unknown test counts.

## Clients

The same CLI can be called from a terminal, Claude Code or Codex. A session needs permission to execute the command and write the record. Client labels are supplied by the caller; they do not authenticate the application.

`--agent` accepts `claude`, `codex` or `other`. `--client` accepts `cli`, `desktop` or `unknown`. These are record labels, not native integrations or automatic client detection.

Schema-2 records separately include unauthenticated [client context](client-context.md). The exact `CLAUDECODE=1` environment marker and optional common hook metadata never choose or authenticate a label. Schema-1 records remain verifiable without observations.

See the [Claude Code](claude-code.md) and [Codex](codex.md) guides for instruction-file examples, and [validation](../validation/RESULTS.md) for measured checks.

## Process lifecycle

Managed tree scope supports Linux process groups and Windows Job Objects through bundled PowerShell 5.1/C# sources. Other platforms require explicit direct scope. The Windows launcher needs Add-Type and creation-time job attributes; setup errors fail closed. No runtime npm dependency or execution-policy change is required. See [process control](process-control.md) for measured boundaries, startup cost and escape paths.
