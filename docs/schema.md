# Schema 2

New records use `schema: agent-test-ledger/2`. The verifier also accepts `agent-test-ledger/1`. UTF-8 JSON, at most 1 MiB and 24 nesting levels. Records are data, never executable recipes.

| Property | Meaning |
| --- | --- |
| id, task | UUID and user-provided task description |
| startedAt, endedAt | UTC ISO timestamps |
| command | Supplied program, literal args, shell false |
| workingDirectory | Dot or path relative to supplied project root |
| process | Status, nullable exit code/signal/error, timeout, duration, output completeness |
| processControl | Required in schema 2: selected scope/strategy and cleanup status/error |
| tests | Parser, status, nullable total/passed/failed/cancelled/skipped/todo counts, emptyFiles and report |
| output | Per-stream captured bytes/SHA-256, complete or prefix scope, rawStored false |
| limits | Requested timeout and combined byte limit |
| artifacts | Explicit relative paths, before/after hashes, changedDuringRun flag |
| git | Exact-root availability, pre-run commit and dirty state; nullable when unavailable |
| labels | Agent and client, each source user-supplied |
| observations | Required in schema 2: unauthenticated environment and optional hook metadata |
| selfHash | Upstream canonical SHA-256 excluding selfHash and signature |
| signature | Optional Ed25519 signature over UTF-8 selfHash |

Agents: claude, codex, other. Clients: cli, desktop, unknown. Label provenance is always user-supplied. Observations are separate and never authenticate these labels or infer an interface.

Schema 2 requires `observations: {authenticated: false, environment: [], hook: null}`. The environment array may contain one exact `{source: "environment", name: "CLAUDECODE", value: "1"}` entry. A non-null hook is exactly `{source: "hook-input", sha256, bytes, event, sessionSha256}` with lowercase SHA-256 values, 1–65536 bytes and a supported event. Extra observation fields, duplicate environment entries and authenticated claims are rejected. Schema 1 must not contain observations; its previous verification and passing-evidence rules remain unchanged. See [client context](client-context.md) for input validation and privacy limits.

Passed requires recognized counts, a passed test, no failures/cancellations and exit 0. All skipped is skipped-only; todo-only or mixed skipped/todo is not-run. Zero tests is no-tests.

`tests.emptyFiles` counts passing top-level entries that Node emits for a selected test file that registered no tests (empty, conditional or exited early); such an entry is named after an existing file and has no subtests. These entries are not test results: if nothing else ran the status is no-tests, otherwise not-run. Raw `counts` keep Node's summary unchanged. A real top-level test named exactly like an existing file is conservatively treated the same way. `emptyFiles` is null when counts are unknown. Records created before this field existed remain verifiable but never count as current passing evidence. Unrecognized output is unknown; timeout, launch error and output overflow are incomplete.

Verification returns integrity, requested signature verification, freshness and currentTestEvidence separately. Files changed during a run remain stale even if current bytes match their final hash. Missing/unsafe files are stale. No tracked files is untracked. Valid failed-test records never count as current passing evidence.

Parsers are `node-tap-summary`, `jest-json`, `vitest-json`, `pytest-junit` and `unknown`. The Node parser consumes native TAP stdout; Jest/Vitest adapters consume only the JSON file named by the recognized direct Node invocation. The pytest adapter consumes the JUnit XML file named by a direct `python -m pytest` invocation. For these file adapters `tests.report` contains `{path, sha256, bytes}`: the path relative to the supplied project root, SHA-256 of the report bytes and report size (at most 16 MiB). Other parsers use null (older records may omit it). File adapters use `emptyFiles: 0`. Pytest counts testcase elements and validates suite marker totals; failed calls followed by teardown errors can create two failed entries. An empty pytest report with exit 5 is no-tests; every other nonzero exit remains failed or unknown.

The report must be newly created, or its content hash must differ from the safe pre-run file. An unchanged existing report is not reused and produces `unknown`, even if the command exits 0. Identical rewrites are conservatively unknown. Unsafe or sensitive report paths are rejected before execution, including new files whose existing parents resolve outside root or into excluded directories. Parent validation creates no directories; dangling links, loops and non-directory parents are rejected. Concurrent filesystem races remain outside this check's guarantees. `--outputFile` or pytest `--junit-xml` / `--junitxml` resolves against the command's working directory and must remain inside root; the receipt and HTML do not embed the raw report. Verification checks the recorded report/command/schema linkage; it does not reread that report file. Include the report as an artifact separately only when you want it checked for freshness (artifacts must exist before execution).

Legacy schema 0.1/0.2 uses `node receipt.mjs verify`; no conversion fabricates missing counts.

Schema 2 requires a strictly shaped `processControl` object: `{scope, strategy, cleanup: {status, errorCode}}`. Scope is tree or direct; strategies are windows-job, posix-process-group, direct-child or unsupported. Cleanup status is confirmed, not-started, unconfirmed or failed. Confirmed/not-started have null errors; failed/unconfirmed have stable uppercase error codes. Completed commands cannot claim not-started. Unsupported strategy is a tree-scope launch error with not-started cleanup. Failed/unconfirmed cleanup prevents current passing evidence; direct scope can provide passing test evidence while confirming only the immediate child. Schema 1 has no processControl field and keeps its previous evidence semantics. See [process control](process-control.md).
