# Validation

## 0.10.0 (unreleased)

| Check | Environment | Passed | Failed | Skipped |
| --- | --- | ---: | ---: | ---: |
| Full verify with real pytest/Jest/Vitest | Windows, Node 24.14.0 | 77 | 0 | 3 |
| Full verify | Linux container, Node 22.23.4, two CPUs | 72 | 0 | 8 |
| Full verify | Linux container, Node 24.22.3, two CPUs | 72 | 0 | 8 |
| Installed-package smoke and local documentation links | Windows and both Linux environments above | 1 each | 0 | 0 |

Each full suite contains 80 tests. Windows uses Python 3.13.5 with pytest 9.2.0, Jest 30.5.2 and Vitest 5.1.0; its three skips are Linux-only checks. The Linux containers run as a nonroot user with a read-only source mount, no network and two CPUs. They skip four Windows-only checks and four optional runner checks because Python/Jest/Vitest are not installed there. Those skipped checks are not passing measurements.

Commands:

```sh
npm run verify
node --test --test-reporter=tap package.test.mjs
```

The real-runner Windows run sets `LEDGER_PYTHON` and `LEDGER_RUNNER_MODULES` as described in [Contributing](../CONTRIBUTING.md). Hosted CI is configured to install all three runners before verification on Windows/Linux and Node 22/24; hosted results are separate from the local measurements above.

The package smoke creates a real npm archive, installs it offline with lifecycle scripts disabled, checks the installed executable mapping, and runs signed schema-2 records through run/verify/report. It exercises the native Windows helper or Linux process group, checks privacy and HTML escaping, verifies both genuine example schemas, and checks local Markdown links inside the installed archive. The package has zero runtime npm dependencies.

Process tests measure live children and grandchildren before arming delayed side effects. Normal root-first exit, timeout, output overflow, resistant descendants and cancellation must leave no executing members or delayed sentinel files within the selected boundary. Linux real SIGINT and Windows helper/controller termination are separate checks. The maximum accepted timeout is tested against timer overflow.

Report-path checks reject outside-root or excluded parent aliases, dangling links, loops and non-directory parents before any recognized runner command starts. Safe in-root aliases and missing ordinary directories remain supported; validation itself creates no directories.

The schema-2 greeting example is an actual three-test Windows run with confirmed Job Object cleanup. The schema-1 example remains unchanged. These measurements do not cover actual Windows console Ctrl+C, older/non-x64 Windows, unusual host-job restrictions or actual client sessions. Hook fixtures and environment observations do not authenticate a client.

## 0.9.1 — 2026-11-13

| Check | Environment | Passed | Failed | Skipped |
| --- | --- | ---: | ---: | ---: |
| Default verify | Windows, Node 24.14.0 | 49 | 0 | 2 |
| With Jest 30.5.2 and Vitest 5.1.0 | Windows, Node 24.14.0 | 50 | 0 | 1 |

Each suite contains 51 tests. The default suite skips the optional real-runner test. Windows also skips the POSIX FIFO regression. The real-runner test covers twelve scenarios: pass, fail, empty file, skip-only, todo-only and noisy stdout for each runner.

`npm ci --ignore-scripts` passed. The quickstart greeting example passed all 3 tests, verified as current evidence and produced its offline HTML report.

`npm pack` succeeded. Verification from a separately extracted package also passed: 49 tests passed, no failures and the same two expected skips on Windows.

The suite covers command outcomes, test classification, empty files, signatures and key errors, time/output bounds, path containment, changed artifacts, HTML escaping, exclusive output creation and non-execution during verify/report.

CI is configured for Windows and Linux on Node 22 and 24, including the real-runner suite. Hosted results are recorded after the jobs finish.

Client labels are supplied by the caller. These checks do not establish client authentication, process-tree isolation, complete secret detection or protection against concurrent filesystem races.
