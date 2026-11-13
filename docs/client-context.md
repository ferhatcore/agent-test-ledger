# Client context

Client labels are supplied by the caller. Environment observations record signals visible to the process when the run starts. These signals can be changed or inherited and do not authenticate the client or interface.

`--agent` and `--client` remain labels. The ledger does not change them when an observation disagrees, and it never selects CLI or Desktop automatically. Observations do not change test counts, signatures, file freshness or current passing evidence.

## Environment marker

When `CLAUDECODE` is exactly `1`, the record includes an environment entry with that name and value. Other values are ignored. This is the marker documented for [Claude Code subprocesses](https://code.claude.com/docs/en/env-vars); any process can set or inherit it. No other environment values are copied.

## Optional hook input

Pass a project-relative JSON file with `--client-context`:

```sh
node ledger.mjs run --task "Tests" --client-context context.json --artifact src/app.mjs -- node --test --test-reporter=tap app.test.mjs
```

The path resolves against `--root`, even when `--cwd` differs. The input must be a regular UTF-8 JSON file, at most 64 KiB with no more than 16 nesting levels. Root escapes, sensitive paths and symlinks to sensitive targets are rejected before the command starts. UTF-8 BOMs are not accepted for this JSON input.

The supported common fields are:

```json
{
  "session_id": "example-session-id",
  "cwd": "/path/to/project",
  "hook_event_name": "PostToolUse"
}
```

`session_id` must be a nonempty string of at most 1024 characters; `cwd` must be a nonempty string of at most 8192 characters. Both reject control characters and unpaired surrogates. Supported events are `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse` and `Stop`, shared by the [Claude Code](https://code.claude.com/docs/en/hooks#common-input-fields) and [Codex](https://learn.chatgpt.com/docs/hooks#common-input-fields) hook interfaces. Other events are rejected. This checks common metadata, not an event's full tool payload. Additional event fields are ignored; top-level identity/provenance claims such as `authenticated`, `agent`, `client` and `observations` are rejected.

For `SessionStart`, an optional `source` may be `startup`, `resume`, `clear`, `compact` or `fork`, as documented by [Codex](https://learn.chatgpt.com/docs/hooks#sessionstart). It describes a start reason, not client identity, and is validated then discarded. A common-field-only input without `source` also remains supported. Supplied `source` values outside that list, or on other events, are rejected.

The ledger does not install a hook or read a transcript. A wrapper can save its hook input to a file before invoking the ledger. Keep that input out of version control and distributable files; it may contain private event data.

## Stored evidence

New schema-2 records require `observations`:

| Field | Stored value |
| --- | --- |
| `authenticated` | Always `false` |
| `environment` | Empty array or the exact `CLAUDECODE=1` entry with `source: environment` |
| `hook` | Null, or `source: hook-input`, input SHA-256/byte count, event and `sessionSha256` |

The session fingerprint is SHA-256 of the UTF-8 session ID. It allows records with the same supplied ID to be compared; it is not encryption, proof of a session or anonymous identity. Do not use a secret as a session ID. Raw session IDs, working directories, transcript paths, model names, tool inputs and arbitrary environment data are not copied into observations or HTML. The input path is not stored either.

Hook hashes describe the bytes read before command execution. Verification checks record consistency, not the continued existence or contents of the hook file. Schema-1 records remain verifiable and show observations as not recorded. A local signature proves possession of the supplied key, not that a particular client supplied these signals.
