// Copyright (c) 2026 Ferhat Kosger. MIT License.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pytestRunner, parsePytestReport } from './lib/pytest.mjs';
import { runLedger, verifyLedger } from './lib/ledger.mjs';
import { selfHashOf } from './receipt.mjs';
import { renderReport } from './lib/report.mjs';
import { MAX_REPORT } from './lib/runners.mjs';

const command = (...args) => ({ program: 'python', args: ['-m', 'pytest', ...args] });
const report = (cases = '<testcase name="ok" />', summary = 'tests="1" failures="0" errors="0" skipped="0"') => `<?xml version="1.0" encoding="utf-8"?><testsuites name="pytest tests"><testsuite ${summary}>${cases}</testsuite></testsuites>`;
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'ledger-pytest-ü '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('pytest recognition requires direct Python module execution and one report destination', () => {
  for (const program of ['python', 'python.exe', 'python3', '/bin/python3.13', 'C:\\venv\\python.exe'])
    assert.deepEqual(pytestRunner({ ...command('--junit-xml=r.xml'), program }), { runner: 'pytest', outputFile: 'r.xml' });
  assert.equal(pytestRunner(command('--junitxml', 'r.xml')).outputFile, 'r.xml');
  for (const args of [[], ['--junit-xml='], ['--junit-xml=r', '--junitxml=s'], ['--junit-xml', '--help'], ['--', '--junit-xml=r'],
    ...['--collect-only', '--co', '--help', '-h', '-V', '--version', '--fixtures', '--funcargs', '--fixtures-per-test', '--cache-show', '--trace-config', '--markers', '--setup-plan', '--setup-only'].map(a => ['--junit-xml=r', a])])
    assert.equal(pytestRunner(command(...args)), null, JSON.stringify(args));
  for (const c of [{program: 'pytest', args: ['--junit-xml=r']}, {program: 'py', args: ['-m', 'pytest', '--junit-xml=r']}, {program: 'python', args: ['app.py', '-m', 'pytest', '--junit-xml=r']}, {program: 'python', args: ['-c', 'x', '-m', 'pytest', '--junit-xml=r']}]) assert.equal(pytestRunner(c), null);
});

test('pytest XML counts actual cases and validates all marker totals', () => {
  assert.deepEqual(parsePytestReport(report(), 0), { total: 1, passed: 1, failed: 0, cancelled: 0, skipped: 0, todo: 0 });
  const teardown = report('<testcase name="a"><error message="teardown failed">trace</error></testcase>', 'tests="1" failures="0" errors="1" skipped="0"');
  assert.equal(parsePytestReport(teardown, 1).passed, 0);
  assert.equal(parsePytestReport(teardown, 0), null);
  const double = report('<testcase name="a"><failure /></testcase><testcase name="a"><error /></testcase>', 'tests="2" failures="1" errors="1" skipped="0"');
  assert.equal(parsePytestReport(double, 1).failed, 2);
  const skipError = report('<testcase name="a"><skipped /><error /></testcase>', 'tests="1" failures="0" errors="1" skipped="1"');
  assert.equal(parsePytestReport(skipError, 1).failed, 1);
  const empty = report('', 'tests="0" failures="0" errors="0" skipped="0"');
  assert.equal(parsePytestReport(empty, 5).total, 0);
  assert.equal(parsePytestReport(report(), 5), null);
  for (const code of [1, 2, 3, 4, 6]) assert.equal(parsePytestReport(report(), code).passed, 1);
  for (const code of [-1, null, 7]) assert.equal(parsePytestReport(report(), code), null);
  const escaped = report('<properties><property name="x" value="a &amp; b" /></properties><testcase name="ü&#x1f600;&quot;"><system-out>&lt;x&gt;</system-out></testcase>');
  assert.equal(parsePytestReport(escaped, 0).passed, 1);
  assert.equal(parsePytestReport(report().replace('encoding="utf-8"', 'encoding="UTF-8"'), 0).passed, 1);
  assert.equal(parsePytestReport('\ufeff' + report(), 0).passed, 1);
  assert.equal(parsePytestReport('\ufeff\ufeff' + report(), 0), null);
  assert.equal(parsePytestReport(report().replace('<testcase name="ok" />', '<testcase\tname\r=\n"ok"\t/>'), 0).passed, 1);
  assert.equal(parsePytestReport(report('<testcase name="a\u00a0b"><system-out>text\u00a0\u2028</system-out></testcase>'), 0).passed, 1);
});

test('pytest XML rejects malformed, contradictory and hostile structures', () => {
  for (const xml of ['', report().slice(0, -1), report() + report(), report().replace('tests="1"', 'tests="2"'), report().replace('errors="0"', 'errors="1"'),
    report().replace('tests="1"', 'tests="1" tests="1"'), report().replace('<testsuites ', '<!DOCTYPE x [<!ENTITY e "bad">]><testsuites '),
    report('<testcase name="&evil;"/>'), report('<testcase name="&#0;"/>'), report('<testcase name="x\u0001"/>'),
    report('<testcase name="a"><failure/><error/></testcase>'), report('<testcase name="a"><failure/><skipped/></testcase>'), report('<testcase name="a"><skipped/><skipped/></testcase>'),
    report('<testcase name="a"><testcase name="b"/></testcase>'), report('<testcase name="a"><system-out><testcase name="b"/></system-out></testcase>'),
    report('<testcase name="a"><![CDATA[hello]]></testcase>'), report('<testcase name="a"><?instruction x?></testcase>'), report('<testcase name="a">unexpected text</testcase>'),
    report('<testcase name="a"><system-out>]]></system-out></testcase>'), report('<testcase name="a"><failure></error></testcase>'), report('<testcase/>'),
    report().replace('<testsuites ', '<testsuites tests="999" '), report().replace('tests="1"', 'tests="9007199254740992"'), ' '.repeat(MAX_REPORT + 1)]) assert.equal(parsePytestReport(xml, 0), null, xml.slice(0, 200));
});

test('pytest XML uses XML whitespace and case-sensitive declaration syntax', () => {
  for (const separator of ['\u00a0', '\u2028', '\ufeff']) {
    for (const xml of [
      report().replace('<testcase name=', `<testcase${separator}name=`),
      report().replace('name="ok"', `name${separator}="ok"`),
      report().replace('name="ok"', `name=${separator}"ok"`),
      report().replace(' />', `${separator}/>`),
      report().replace('</testsuite>', `</testsuite${separator}>`),
      report().replace('<testcase ', `${separator}<testcase `),
      report() + separator,
    ]) assert.equal(parsePytestReport(xml, 0), null, JSON.stringify(xml));
  }
  for (const xml of [report().replace('<?xml ', '<?XML '), report().replace('version=', 'VERSION='), report().replace('encoding=', 'ENCODING=')])
    assert.equal(parsePytestReport(xml, 0), null, xml);
});

const python = process.env.LEDGER_PYTHON;
test('pytest report decoding preserves a single BOM for XML validation', { skip: !python && 'set LEDGER_PYTHON to Python with pytest installed', timeout: 30000 }, async t => {
  const root = fixture(t);
  for (const count of [1, 2]) {
    const cwd = `bom-${count}`, directory = join(root, cwd), bytes = Buffer.from('\ufeff'.repeat(count) + report());
    mkdirSync(directory); writeFileSync(join(directory, 'pytest.ini'), '[pytest]\n');
    writeFileSync(join(directory, 'test_sample.py'), `import atexit\nfrom pathlib import Path\natexit.register(lambda: Path("bom.xml").write_bytes(bytes.fromhex("${bytes.toString('hex')}")))\ndef test_ok():\n    assert True\n`);
    const r = await runLedger({ task: 'Report byte order mark', root, cwd, program: resolve(python), args: ['-m', 'pytest', '-c', 'pytest.ini', '--junitxml=bom.xml'], artifacts: [`${cwd}/test_sample.py`] });
    assert.equal(r.process.exitCode, 0); assert.deepEqual(readFileSync(join(directory, 'bom.xml')), bytes);
    assert.equal(r.tests.parser, count === 1 ? 'pytest-junit' : 'unknown');
    assert.equal(r.tests.status, count === 1 ? 'passed' : 'unknown');
    const verification = verifyLedger(r, { root }); assert.equal(verification.valid, true); assert.equal(verification.currentTestEvidence, count === 1);
  }
});

test('pytest reports reject malformed UTF-8 before and after execution', { skip: !python && 'set LEDGER_PYTHON to Python with pytest installed', timeout: 30000 }, async t => {
  const root = fixture(t), valid = report(), offset = valid.indexOf('ok');
  for (const [index, invalidBytes] of [[0xff], [0xc3], [0xc0, 0xaf]].entries()) {
    const cwd = `encoding-${index}`, directory = join(root, cwd);
    const bytes = Buffer.concat([Buffer.from(valid.slice(0, offset)), Buffer.from(invalidBytes), Buffer.from(valid.slice(offset + 2))]);
    mkdirSync(directory); writeFileSync(join(directory, 'pytest.ini'), '[pytest]\n');
    // The exit handler replaces the report after pytest's reporter has finished.
    writeFileSync(join(directory, 'test_sample.py'), `import atexit\nfrom pathlib import Path\natexit.register(lambda: Path("invalid.xml").write_bytes(bytes.fromhex("${bytes.toString('hex')}")))\ndef test_ok():\n    assert True\n`);
    const go = () => runLedger({ task: 'Report encoding', root, cwd, program: resolve(python), args: ['-m', 'pytest', '-c', 'pytest.ini', '--junitxml=invalid.xml'], artifacts: [`${cwd}/test_sample.py`] });
    const r = await go();
    assert.equal(r.process.exitCode, 0); assert.deepEqual(readFileSync(join(directory, 'invalid.xml')), bytes);
    assert.equal(r.tests.parser, 'unknown'); assert.equal(r.tests.status, 'unknown');
    const verification = verifyLedger(r, { root }); assert.equal(verification.valid, true); assert.equal(verification.currentTestEvidence, false);
    await assert.rejects(go(), /invalid UTF-8/);
  }
});
test('real pytest JUnit results, report guards and verification', { skip: !python && 'set LEDGER_PYTHON to Python with pytest installed', timeout: 120000 }, async t => {
  const root = fixture(t);
  const cases = {
    pass: ['def test_ok():\n    assert True\n', 'passed', 0, [1, 1, 0, 0]],
    fail: ['def test_bad():\n    assert False\n', 'failed', 1, [1, 0, 1, 0]],
    skip: ['import pytest\ndef test_skip():\n    pytest.skip("later")\n', 'skipped-only', 0, [1, 0, 0, 1]],
    xfail: ['import pytest\n@pytest.mark.xfail\ndef test_xfail():\n    assert False\n', 'skipped-only', 0, [1, 0, 0, 1]],
    xpass: ['import pytest\n@pytest.mark.xfail\ndef test_xpass():\n    assert True\n', 'passed', 0, [1, 1, 0, 0]],
    strict: ['import pytest\n@pytest.mark.xfail(strict=True)\ndef test_strict():\n    assert True\n', 'failed', 1, [1, 0, 1, 0]],
    empty: ['# no tests\n', 'no-tests', 5, [0, 0, 0, 0]],
    setup: ['import pytest\n@pytest.fixture\ndef thing():\n    assert False\ndef test_setup(thing):\n    pass\n', 'failed', 1, [1, 0, 1, 0]],
    teardown: ['import pytest\n@pytest.fixture\ndef thing():\n    yield\n    assert False\ndef test_teardown(thing):\n    pass\n', 'failed', 1, [1, 0, 1, 0]],
    double: ['import pytest\n@pytest.fixture\ndef thing():\n    yield\n    assert False\ndef test_double(thing):\n    assert False\n', 'failed', 1, [2, 0, 2, 0]],
    skipteardown: ['import pytest\n@pytest.fixture\ndef thing():\n    yield\n    assert False\ndef test_skip(thing):\n    pytest.skip("later")\n', 'failed', 1, [1, 0, 1, 0]],
    collection: ['raise RuntimeError("collection failed")\n', 'failed', 2, [1, 0, 1, 0]],
  };
  const go = (cwd, extra = [], options = {}) => runLedger({ task: 'pytest test results', root, cwd, program: resolve(python), args: ['-m', 'pytest', '-c', 'pytest.ini', '--junit-xml=résult.xml', ...extra], artifacts: [`${cwd}/test_sample.py`], ...options });
  let passing;
  for (const [name, [source, status, exit, counts]] of Object.entries(cases)) {
    mkdirSync(join(root, name)); writeFileSync(join(root, name, 'test_sample.py'), source); writeFileSync(join(root, name, 'pytest.ini'), '[pytest]\n');
    const r = await go(name);
    assert.equal(r.process.exitCode, exit, name); assert.equal(r.tests.parser, 'pytest-junit', name + ': ' + readFileSync(join(root, name, 'résult.xml'), 'utf8'));
    assert.equal(r.tests.status, status, name); assert.deepEqual(['total', 'passed', 'failed', 'skipped'].map(k => r.tests.counts[k]), counts, name);
    const verification = verifyLedger(r, { root }); assert.equal(verification.valid, true, verification.problems.join(' ')); assert.equal(verification.currentTestEvidence, status === 'passed', name);
    if (name === 'pass') passing = r;
  }
  for (const mutate of [r => r.tests.report.path = 'other.xml', r => r.tests.parser = 'jest-json', r => r.command.args.push('--collect-only'), r => r.command.program = 'pytest', r => r.tests.emptyFiles = null, r => r.process.exitCode = 5, r => r.tests.counts.todo = 1]) {
    const r = structuredClone(passing); mutate(r); r.selfHash = selfHashOf(r); assert.equal(verifyLedger(r, { root }).valid, false);
  }
  const html = renderReport(passing, verifyLedger(passing, { root })); assert.ok(html.includes('pytest-junit')); assert.ok(html.includes(passing.tests.report.sha256));
  assert.equal((await go('pass', ['-k', 'never_matches'])).tests.status, 'no-tests');
  const before = readFileSync(join(root, 'pass', 'résult.xml'));
  assert.equal((await go('pass', ['--help'])).tests.parser, 'unknown'); assert.deepEqual(readFileSync(join(root, 'pass', 'résult.xml')), before);
  // Disabling the reporter leaves an existing valid report unchanged.
  assert.equal((await go('pass', ['-p', 'no:junitxml'])).tests.parser, 'unknown'); assert.deepEqual(readFileSync(join(root, 'pass', 'résult.xml')), before);
  for (const destination of ['../../outside.xml', 'C:/outside.xml', '.env', 'private.pem']) {
    await assert.rejects(go('pass', [], { args: ['-m', 'pytest', `--junitxml=${destination}`] }));
  }
  const large = await go('pass', [], { maxOutputBytes: 1 }); assert.equal(large.tests.status, 'incomplete'); assert.equal(large.tests.parser, 'unknown');
  const oversizedSource = 'def test_large(record_property):\n    record_property("large", "x" * (17 * 1024 * 1024))\n';
  writeFileSync(join(root, 'pass', 'test_sample.py'), oversizedSource);
  assert.equal((await go('pass')).tests.parser, 'unknown');
  writeFileSync(join(root, 'pass', 'résult.xml'), 'x'.repeat(MAX_REPORT + 1)); await assert.rejects(go('pass'), /too large/);
  writeFileSync(join(root, 'pass', 'résult.xml'), report());
  mkdirSync(join(root, '.aws')); writeFileSync(join(root, '.aws', 'credentials'), report());
  symlinkSync(join(root, '.aws'), join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(go('pass', [], { args: ['-m', 'pytest', '--junitxml=../alias/credentials'] }), /unsafe|sensitive/);
});
