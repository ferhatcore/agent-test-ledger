# Agent Test Ledger

A local CLI for running test commands and recording results and file freshness. Works from a terminal, Claude Code or Codex. Requires Node.js 22 or later, with no npm runtime dependencies or external services.

Process outcome, test outcome and file freshness are separate. Exit 0 does not mean tests ran. A `codex` label does not prove a Codex session ran.

## Supported workflows

For developers using Claude Code, Codex or a terminal who want a local record of a test command and the freshness of explicitly listed files. Supported counts come from Node `node:test` with TAP, Jest/Vitest JSON reports through direct `node .../bin` entrypoints, or pytest JUnit XML through `python -m pytest` (see below). The ledger has zero runtime dependencies; Jest, Vitest or pytest must already be installed in the project being tested.

`npm test` wrappers and unsupported runner invocations record process outcomes but keep test counts and test success `unknown`. The tool does not authenticate AI clients, track every project dependency or prove honest execution. Only listed files determine freshness, and managed cleanup is limited to the selected Linux process group or Windows job (see [process control](docs/process-control.md)).

## Quickstart

This source tree contains unreleased 0.10.0 changes. The npm commands below install 0.9.1. Pytest counts, client observations and managed process trees require the source checkout until 0.10.0 is published.

With Node.js >=22, run the published package without a global installation:

```sh
npx agent-test-ledger@0.9.1 --help
```

Or install the CLI globally:

```sh
npm install --global agent-test-ledger@0.9.1
agent-test-ledger --help
```

For released features, use `agent-test-ledger run|verify|report` in place of `node ledger.mjs run|verify|report`. Run from the project being tested and list its relevant files explicitly. The npm package is [agent-test-ledger](https://www.npmjs.com/package/agent-test-ledger).

From this project's root, in PowerShell or a POSIX terminal:

```sh
node ledger.mjs --help
node ledger.mjs run --task "Check greeting" --agent other --client cli --artifact examples/tiny-cli/cli.mjs --artifact examples/tiny-cli/cli.test.mjs --out greeting.json -- node --test --test-reporter=tap examples/tiny-cli/cli.test.mjs
node ledger.mjs verify greeting.json
node ledger.mjs report greeting.json --out greeting.html
```

Open `greeting.html` locally; no network connection is needed. Use new output names on repeat runs: files are never overwritten. Omit `--out` on `run` for `.test-ledger/<UUID>.json`. No installation is needed. The npm executable mapping is `agent-test-ledger`; examples use `node ledger.mjs` to avoid requiring global installation.

For another project, launch `ledger.mjs` by its path from that project's root. Quote paths with spaces. `--artifact` paths use `/` on both platforms, must be relative to `--root`, and must name existing files. Explicitly include relevant source, tests, fixtures and configuration. Unlisted dependencies and new files are not automatically tracked.

## Results and exit codes

| Field | Meaning |
| --- | --- |
| `process.status` | `completed`, `launch-error`, `timed-out`, `output-limit`, `interrupted`, `control-error` |
| `processControl` | Selected scope/strategy and measured cleanup result |
| `tests.status` | `passed`, `failed`, `no-tests`, `skipped-only`, `not-run`, `unknown`, `incomplete` |
| `tests.counts` | Total, passed, failed, cancelled, skipped, todo; null if unrecognized |
| `tests.parser` | `node-tap-summary`, `jest-json`, `vitest-json`, `pytest-junit` or `unknown` |
| `tests.report` | Jest/Vitest/pytest report path relative to root, SHA-256 and byte count; otherwise null |
| `tests.emptyFiles` | Selected test files that registered no tests; any nonzero value prevents `passed` |
| `observations` | Unauthenticated environment marker and optional hook fingerprints, separate from caller labels |
| Verification `integrity` | `consistent` or `invalid`; consistency is not authentication |
| Verification `signature` | `not-checked`, `invalid`, `verified-with-supplied-key` |
| Verification `freshness` | `current`, `stale`, `untracked`, `unknown` |
| `currentTestEvidence` | Passing tests, exit 0, confirmed selected-scope cleanup, valid requested signature and current explicitly listed files |

`run` returns 0 for recognized passing tests, exit 0, confirmed cleanup within the selected scope and unchanged listed snapshots; otherwise 1, while still writing a record. Without artifacts it can return 0, but freshness remains `untracked` and `currentTestEvidence` is false. `verify` returns 0 for a consistent record with no stale files and a valid signature if requested. It can return 0 for a correctly recorded failed test: inspect `tests.status` or `currentTestEvidence` for a QA gate. Invalid/stale verification returns 1. `report` uses the same rule and writes HTML even for invalid/stale records. Usage, input and output errors return 2; malformed JSON cannot be rendered.

Counts require native Node TAP output (`node --test --test-reporter=tap`), a JSON report produced by a recognized direct Node Jest/Vitest invocation, or a JUnit report from a recognized direct Python pytest invocation. Other programs, npm/shell wrappers, Node spec/default output and incomplete or ambiguous summaries stay unknown. TAP requires a header, one numerical summary, consistent totals and a closing duration. These adapters observe output; a malicious command can forge it.

New records use schema 2; schema-1 records remain verifiable. Client labels stay user supplied. Separate observations include only the exact `CLAUDECODE=1` environment marker and optional bounded hook metadata via `--client-context PATH`. Both can be forged or inherited and never authenticate a client or select CLI/Desktop. See [client context](docs/client-context.md) for input validation and privacy limits.

### pytest

For pytest, use its built-in JUnit reporter with a single explicit destination:

```sh
node ledger.mjs run --task "Python tests" --artifact src/app.py --out pytest-record.json -- python -m pytest --junit-xml=pytest-results.xml
```

`--junitxml` is also supported. Direct `python`, `python.exe`, `python3` and `python3.N` executables are recognized, including full paths. Python launcher and shell wrappers stay unknown. Counts describe testcase elements: setup, teardown and collection errors count as failed entries; a call failure plus a teardown error can produce two entries. Skip and xfail count as skipped; non-strict xpass counts as passed and strict xpass as failed. Exit 5 with an empty report is no-tests. See [pytest support](docs/pytest.md) for boundaries.

### Jest and Vitest

With the runner already installed in your project, use its Node entrypoint and an explicit JSON report destination. For example, with existing `src/app.js` and matching tests:

```sh
node ledger.mjs run --task "Jest tests" --artifact src/app.js --out jest-record.json -- node node_modules/jest/bin/jest.js --json --outputFile=jest-results.json
node ledger.mjs run --task "Vitest tests" --artifact src/app.js --out vitest-record.json -- node node_modules/vitest/vitest.mjs run --reporter=json --outputFile=vitest-results.json
```

Jest may use `--experimental-vm-modules` before its script. Vitest also accepts `--outputFile.json=FILE`. The report path resolves against `--cwd`, must stay inside `--root`, use `/` separators and avoid sensitive names. The report must be newly created or have different bytes from its safe pre-run version; an unchanged report gives `unknown`, including an identical rewrite. Watch/informational modes, Jest result processors and unsupported reporter configurations stay unknown. Reports are bounded to 16 MiB; the ledger stores their path/hash/size rather than raw JSON. Only listed artifacts determine freshness; verify checks report metadata linkage without rereading the report file. Compatibility is exercised with Jest 30.5.2 and Vitest 5.1.0.

## Options and optional signing

```sh
node ledger.mjs run --task "Bounded check" --timeout 10000 --max-output 1048576 --artifact examples/tiny-cli/cli.mjs -- node --test --test-reporter=tap examples/tiny-cli/cli.test.mjs
node ledger.mjs keygen --out-dir keys
node ledger.mjs run --task "Signed check" --sign-key keys/private.pem --out signed.json --artifact examples/tiny-cli/cli.mjs -- node --test --test-reporter=tap examples/tiny-cli/cli.test.mjs
node ledger.mjs verify signed.json --pubkey keys/public.pem
node ledger.mjs report signed.json --pubkey keys/public.pem --out signed.html
```

Signing is optional and reuses upstream Ed25519 code. Obtain the public key through a trusted channel. Signatures prove key possession, not honest execution. Windows mode 0600 does not guarantee account ACL protection.

Managed tree scope is the default on Windows and Linux. Use `--process-scope direct` explicitly for immediate-child control, including on other platforms. Direct mode does not promise descendant cleanup. Windows requires the bundled PowerShell 5.1/C# launcher; setup errors stop before the command. See [process control](docs/process-control.md) for startup cost and boundaries.

`--root DIR` selects the project root; `--cwd PATH` is relative to it. Receipt, output and key arguments resolve against the invoking directory. Timeout defaults to 300000 ms. `--max-output` bounds combined captured stdout/stderr (default 1 MiB; maximum 16 MiB). Each stream has a byte count and SHA-256. Interrupted hashes cover captured prefixes, not necessarily full output. Raw output is never stored.

Execution always passes separate program/arguments with `shell: false`. There is no shell-string convenience flag. If necessary explicitly name a shell, for example `-- sh -c 'node --test --test-reporter=tap'` where sh is available; shell output stays unknown. Windows `.cmd` programs may need an explicit `cmd.exe` invocation; native Node commands avoid this.

## Trust and privacy

`verify` and `report` never execute stored commands. Artifact paths are confined to the project root, including symlink resolution. Secret-looking paths and recognizable private-key content are excluded. Arguments, task descriptions and relative filenames can still disclose secrets; there is no complete redaction guarantee. Executable paths are recorded as supplied: use `node`, not a personal absolute path, in shareable records.

Snapshots expose persistent file changes during a run, but cannot detect changes reverted before the second snapshot. Only listed files are checked; no files means untracked freshness. Static reports do not update when opened; regenerate them. Commands run with your permissions and inherited environment except Node's internal test IPC context. The ledger is not a sandbox and cannot guarantee termination of all descendants.

## Guides and validation

- [Quickstart](docs/quickstart.md), [architecture](docs/architecture.md), [schema](docs/schema.md)
- [pytest](docs/pytest.md), [client context](docs/client-context.md), [process control](docs/process-control.md)
- [Claude Code](docs/claude-code.md), [Codex](docs/codex.md), [Project OS](docs/project-os.md)
- [Legacy migration](docs/migration.md), [security](SECURITY.md), [provenance](PROVENANCE.md)
- [Test results](validation/RESULTS.md), [compatibility](docs/compatibility.md)
- [Contributing](CONTRIBUTING.md)

```sh
npm ci --ignore-scripts
npm run verify
npm pack --dry-run
```

Set `LEDGER_PYTHON` to a Python executable with pytest 9.2.0 installed, and `LEDGER_RUNNER_MODULES` to a directory containing Jest 30.5.2 and Vitest 5.1.0 to enable the real-runner checks. Without those variables the corresponding checks are reported as skipped.

Windows/Linux CI runs Node 22 and 24 with Python 3.13 and all three external runners. The suite also packs, installs offline and executes the installed CLI, including signed schema-2 records and native helper loading. See the [validation results](validation/RESULTS.md), [npm package](https://www.npmjs.com/package/agent-test-ledger) and [GitHub releases](https://github.com/ferhatcore/agent-test-ledger/releases) for published versions and recorded checks.

Derived from [Kayforkind/agent-receipts](https://github.com/Kayforkind/agent-receipts), MIT, Copyright (c) 2026 NavigatorsLab. New contributions: Copyright (c) 2026 Ferhat Kosger. Original authorship and license are preserved.
