# Example test-recording instructions

Merge this section into existing project instructions after replacing the tool path. This is an example, not an installer.

- Run tests for real through `node path/to/agent-test-ledger/ledger.mjs run --task "TASK-ID" --agent codex --client cli --artifact cli.mjs --artifact cli.test.mjs -- node --test --test-reporter=tap cli.test.mjs`.
- Select the actual related files. Use client desktop only in an actual desktop session. Labels remain user supplied.
- Include the actual new receipt path in task results. Inspect process/tests; verify exit 0 means consistency, not passing tests.
- After source/test/config changes, rerun; never use an old record as current success.
- Never claim an unexecuted check ran. Do not turn denial, timeout, failure or unknown output into success.
- Use verify for freshness and report for offline review. Neither runs tests.
