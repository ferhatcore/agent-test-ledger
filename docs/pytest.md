# pytest

Use pytest's built-in JUnit reporter; no plugin or npm runtime dependency is needed:

```sh
node ledger.mjs run --task "Python tests" --artifact src/app.py --out record.json -- python -m pytest --junit-xml=results.xml
```

The file must be a relative path inside the project root, with `/` separators. `--junitxml` is an alias; both `--junit-xml=FILE` and `--junit-xml FILE` work. Exactly one destination is required. Direct Python module invocation is supported; `py`, bare `pytest`, npm and shell wrappers are not. Collection-only, setup-only and informational invocations retain process evidence with unknown counts.

The adapter accepts the built-in pytest JUnit structure measured with pytest 9.2.0 and Python 3.13. It counts testcase elements, rather than subtracting suite error totals to infer passes. Setup, teardown and collection errors count as failed entries. A failed call followed by a teardown error creates two entries. Skip and xfail count as skipped; non-strict xpass counts as passed, strict xpass as failed. JUnit does not preserve a separate xpass count. These are report-entry counts, not a deduplicated count of Python test functions.

Exit 0 with passing entries can produce passing evidence. Exit 5 with a valid empty report is no-tests. Other nonzero exits cannot produce passing evidence. Unsupported or contradictory reports remain unknown. Timeout and output overflow remain incomplete.

Reports are limited to 16 MiB and a fixed shallow XML structure. DTDs, custom entities, CDATA, comments, processing instructions, malformed XML and contradictory marker totals are rejected. Only the standard XML declaration and predefined/numeric character references are supported. The reporter's single `testsuites`/`testsuite` structure is required; arbitrary JUnit dialects and plugin-specific output are unsupported.

The report must be new or have a different content hash after execution. Identical rewrites and unchanged reports remain unknown. The same root-containment and sensitive-file checks used for other runner reports apply. Records contain the report path, hash and byte size, never its XML contents. Verification checks command/report linkage without executing Python or reading the report again. A malicious executable or plugin can forge a report; recognition is not executable authentication.

Run the optional real-runner checks with `LEDGER_PYTHON` set to a Python executable that already has pytest installed:

```sh
node --test --test-reporter=tap pytest.test.mjs
```

References: [JUnit output](https://docs.pytest.org/en/stable/how-to/output.html#creating-junitxml-format-files), [reporter implementation](https://docs.pytest.org/en/stable/_modules/_pytest/junitxml.html), [exit codes](https://docs.pytest.org/en/stable/reference/exit-codes.html).
