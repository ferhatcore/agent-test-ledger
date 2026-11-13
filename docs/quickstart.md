# Quickstart

For the npm CLI, use Node.js >=22 and `npx agent-test-ledger@0.9.1 --help`, or install with `npm install --global agent-test-ledger@0.9.1` and use `agent-test-ledger --help`. The commands below use the downloaded source; replace `node ledger.mjs` with `agent-test-ledger` after global installation. Run from your project root and select its actual source/test files as artifacts.

Use Node.js >=22. From the downloaded project root, on Windows or Linux:

```sh
node ledger.mjs --help
node ledger.mjs run --task "Check greeting" --agent other --client cli --artifact examples/tiny-cli/cli.mjs --artifact examples/tiny-cli/cli.test.mjs --out greeting.json -- node --test --test-reporter=tap examples/tiny-cli/cli.test.mjs
node ledger.mjs verify greeting.json
node ledger.mjs report greeting.json --out greeting.html
```

Use fresh output names on repeated runs. Open the HTML locally. Change a tracked file and rerun verify: it returns 1 with stale freshness even though the stored test outcome is still passed. Run tests again for current evidence.

In another project, invoke the tool by its path from that project's root. Quote spaces. Artifact paths use `/` on both platforms. Root defaults to the invoking directory; cwd is relative to root. Record, output and key paths resolve against the invoking directory.

`examples/tiny-cli` has three passing tests. `examples/greeting.json` and `examples/greeting.html` come from a real local run without personal absolute paths. Regenerate the report to refresh verification. Signing is optional. See README for status meanings, limits and exit codes.
