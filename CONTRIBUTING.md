# Contributing

Use Node.js 22 or later. Install the checkout and run the checks:

```sh
npm ci --ignore-scripts
npm run verify
npm pack --dry-run
```

The default suite skips optional real-runner checks. Install Jest 30.5.2 and Vitest 5.1.0 in a separate directory and set `LEDGER_RUNNER_MODULES` to that directory's `node_modules`. Set `LEDGER_PYTHON` to a Python 3.13 executable with pytest 9.2.0 installed. CI enables all three runners on Windows and Linux with Node 22 and 24. The package check creates an archive in a temporary directory, installs it offline and exercises the installed CLI; it does not publish a package.

For a bug report, include the Node version, command, expected result and a small reproduction. Remove credentials and private project data before sharing a record. Report security issues through the repository's private vulnerability reporting form.

Keep changes focused and describe the change in the commit title. Add regression coverage for behavior changes. Preserve the MIT license and upstream attribution.
