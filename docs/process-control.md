# Process control

The default `--process-scope tree` manages ordinary descendants using a Linux process group or Windows Job Object. Cleanup runs after normal root-process exit, timeout, output overflow or interruption. Test outcomes and cleanup outcomes are recorded separately.

```sh
agent-test-ledger run --task "Tests" --artifact src/app.js -- node --test --test-reporter=tap
```

`--process-scope direct` explicitly selects immediate-child control. It does not attempt to stop descendants. This mode is available on other platforms and when the managed Windows launcher is unavailable; it is never selected automatically after a setup error. Windows `.cmd`/`.bat` wrappers require an explicit `cmd.exe` invocation; the ledger does not add a shell.

## Linux

The command starts in a new process group with literal arguments and no shell. Cleanup sends TERM, waits up to 300 ms, then sends KILL when needed and checks for up to two seconds. This also works when the original group leader exits before its children. Linux `/proc` state distinguishes executing members from zombies that can remain under a non-reaping container PID 1.

A process that deliberately creates another session can escape the group. Abruptly killing the ledger itself with KILL cannot run its JavaScript cleanup handler. SIGINT and SIGTERM request bounded cleanup and allow the CLI to write an interrupted record.

## Windows

The bundled PowerShell 5.1 bootstrap compiles the bundled C# helper with `Add-Type`. It does not change execution policy. User arguments arrive as JSON and are encoded for `CreateProcessW`; they are never inserted into PowerShell source. Executables are resolved explicitly from a supplied path or PATH (`.exe`/`.com`). Child stdin is NUL, and stdout/stderr remain binary streams.

The helper creates an unnamed, noninheritable Job Object with kill-on-close. Job membership and the three inherited standard handles are supplied atomically with process creation; a setup failure does not launch an uncontained command. No breakaway flag or post-creation assignment fallback is used. After root exit or cancellation the helper terminates remaining job members and waits for the active-process count to reach zero before reporting confirmed cleanup.

The helper monitors the ledger process handle. Ledger death triggers cleanup; helper death closes the job's last handle. A helper that cannot provide a final measured result is recorded as unconfirmed, even if closing its handle probably stopped the processes. Node also bounds startup (30 seconds), command-control responses and final pipe closure. The command timeout starts after native launch, while `durationMs` includes bootstrap and cleanup time.

Native process exit codes are unsigned DWORD values, including 259. Child arguments follow the standard Windows quoting rules used by Node and Python; programs with custom command-line parsers can interpret them differently.

Job membership does not include work created through unrelated brokers, WMI or external services. Job Objects are not a hostile-code sandbox. Managed setup can fail on unsupported Windows versions, restricted PowerShell environments or incompatible host job restrictions; use direct scope explicitly if its weaker boundary is acceptable.

## Evidence

Schema 2 records `processControl` with:

- `scope`: `tree` or `direct`.
- `strategy`: `posix-process-group`, `windows-job`, `direct-child` or `unsupported`.
- `cleanup.status`: `confirmed`, `not-started`, `unconfirmed` or `failed`, plus a nullable stable `errorCode`.

Confirmed means no executing members were observed within the selected boundary. Direct scope confirms only the immediate child. Failed or unconfirmed cleanup prevents `run` success and `currentTestEvidence`, even when recognized tests passed. Cleanup does not authenticate test output or prove that escaped work stopped.

`process.status` also supports `interrupted` and `control-error` (a launcher/control failure after launch may have occurred). A completed root process can have `outputComplete: false` when pipes do not close within the capture bound; such output is hashed as a captured prefix and cannot provide test counts. Schema 1 keeps its previous verification semantics and does not contain process-control evidence.

The automated suite exercises real children and grandchildren, delayed side effects, timeout, overflow, root-first exit, TERM resistance, exact binary streams, quoting and cancellation. It checks real POSIX SIGINT separately. Windows process termination is not equivalent to console Ctrl+C; controller-death and synthetic cancellation tests do not claim a real console trial.
