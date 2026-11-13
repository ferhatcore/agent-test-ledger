# Claude Code

Use the same ledger CLI as Codex. The ledger does not start Claude, require its account or install hooks. Your client must already have command and filesystem access.

Review `examples/instructions/CLAUDE.md` and merge its section into your existing project instructions. Do not overwrite existing CLAUDE.md or .claude settings. Replace the tool path.

```sh
node path/to/agent-test-ledger/ledger.mjs run --task "T-42 greeting fix" --agent claude --client cli --artifact cli.mjs --artifact cli.test.mjs -- node --test --test-reporter=tap cli.test.mjs
```

Run the test command through the ledger and keep the resulting record path. Use `--client desktop` for desktop sessions and `--client cli` for terminal sessions. These labels describe the run; they do not authenticate the client.

The ledger separately records the exact `CLAUDECODE=1` marker when present. An optional `--client-context` file can supply common hook metadata. Both are unauthenticated signals; see [client context](client-context.md) for the supported input and stored fingerprints. No hook is installed automatically.

See the [instruction-file documentation](https://code.claude.com/docs/en/memory) and [compatibility notes](compatibility.md).
