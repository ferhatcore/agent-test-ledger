# Quickstart

The source checkout contains unreleased 0.10.0 features: pytest counts, client observations and managed process trees. The published npm CLI is 0.9.1: use Node.js >=22 and `npx agent-test-ledger@0.9.1 --help`, or install with `npm install --global agent-test-ledger@0.9.1`. Use the source commands below for the new features. Run from your project root and select its actual source/test files as artifacts.

Use Node.js >=22. From the downloaded project root, on Windows or Linux:

```sh
node ledger.mjs --help
node ledger.mjs run --task "Check greeting" --agent other --client cli --artifact examples/tiny-cli/cli.mjs --artifact examples/tiny-cli/cli.test.mjs --out greeting.json -- node --test --test-reporter=tap examples/tiny-cli/cli.test.mjs
node ledger.mjs verify greeting.json
node ledger.mjs report greeting.json --out greeting.html
```

Use fresh output names on repeated runs. Open the HTML locally. Change a tracked file and rerun verify: it returns 1 with stale freshness even though the stored test outcome is still passed. Run tests again for current evidence.

In another project, invoke the tool by its path from that project's root. Quote spaces. Artifact paths use `/` on both platforms. Root defaults to the invoking directory; cwd is relative to root. Record, output and key paths resolve against the invoking directory.

`examples/tiny-cli` has three passing tests. `examples/greeting.json` and `examples/greeting.html` preserve a real schema-1 run without personal absolute paths. `examples/greeting-v2.json` and its HTML report contain a real schema-2 run with confirmed Windows Job Object cleanup. New runs use schema 2 with separate client observations and process-cleanup evidence. Regenerate the report to refresh verification. Signing is optional. See README for status meanings, limits and exit codes.
