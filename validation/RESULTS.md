# Validation

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
