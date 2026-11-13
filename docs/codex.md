# Codex

Codex uses the same CLI, schema and report as Claude Code. No OpenAI model call, API key, native hook or mandatory MCP server is needed by the ledger.

Merge the reviewed section of `examples/instructions/AGENTS.md` into existing project instructions. Do not overwrite AGENTS.md or .codex settings. Replace the tool path. Codex reads AGENTS.md guidance; see [official OpenAI documentation](https://developers.openai.com/codex/guides/agents-md).

```sh
node path/to/agent-test-ledger/ledger.mjs run --task "T-42 greeting fix" --agent codex --client cli --artifact cli.mjs --artifact cli.test.mjs -- node --test --test-reporter=tap cli.test.mjs
```

Use client desktop only for a real desktop session. CLI and desktop are separate trials. Flags stay user supplied and do not authenticate the application. Include the actual record path, and rerun after code changes.

The session needs command execution and write access to create a record. A read-only session can inspect existing records; it cannot complete a workflow that requires file changes. See the [compatibility notes](compatibility.md).
