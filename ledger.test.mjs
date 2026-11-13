import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, symlinkSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { runLedger, verifyLedger } from './lib/ledger.mjs';
import { renderReport } from './lib/report.mjs';
import { readReceipt } from './lib/files.mjs';
import { selfHashOf, signReceipt, generateKeys, makeReceipt, verifyReceipt } from './receipt.mjs';

const cli = resolve('ledger.mjs');
function fixture(t, source = "import {test} from 'node:test'; test('ok', () => {});") {
  const root = mkdtempSync(join(tmpdir(), 'ledger Türkçe space '));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  writeFileSync(join(root, 'sample.test.mjs'), source);
  writeFileSync(join(root, 'file.txt'), 'before');
  return root;
}
const run = (root, extra = {}) => runLedger({ task: 'T-1', root, program: process.execPath, args: ['--test', '--test-reporter=tap', 'sample.test.mjs'], artifacts: ['file.txt'], ...extra });
const invoke = (root, args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 15000 });
const rehash = r => { r.selfHash = selfHashOf(r); return r; };

test('real Node pass, relative Unicode paths, labels and unique IDs', async t => {
  const root = fixture(t), r = await run(root, { agent: 'codex', client: 'desktop' });
  assert.equal(r.tests.status, 'passed'); assert.equal(r.tests.counts.total, 1);
  assert.equal(r.labels.agent.source, 'user-supplied'); assert.equal(r.workingDirectory, '.');
  assert.equal(JSON.stringify(r).includes(root), false);
  assert.equal(verifyLedger(r, { root }).currentTestEvidence, true);
  assert.notEqual(r.id, (await run(root)).id);
});
test('a failing test is a valid record, not current passing evidence', async t => {
  const root = fixture(t, "import {test} from 'node:test'; test('bad', () => {throw Error('bad')});"), r = await run(root);
  assert.equal(r.process.exitCode, 1); assert.equal(r.tests.status, 'failed'); assert.equal(r.tests.counts.failed, 1);
  const v = verifyLedger(r, { root }); assert.equal(v.valid, true); assert.equal(v.currentTestEvidence, false);
});
test('zero tests do not mean success', async t => {
  // Node reports a selected file without tests as one passing file-level test; that is not evidence.
  for (const source of ["import 'node:test';", "import {test} from 'node:test'; if (process.env.NEVER_SET_X) test('x', () => {});", 'process.exit(0);']) {
    const root = fixture(t, source), r = await run(root);
    assert.equal(r.process.exitCode, 0); assert.equal(r.tests.counts.passed, 1);
    assert.equal(r.tests.emptyFiles, 1); assert.equal(r.tests.status, 'no-tests');
    assert.equal(verifyLedger(r, { root }).currentTestEvidence, false);
    assert.equal(invoke(root, ['run', '--task', 'hollow', '--', process.execPath, '--test', '--test-reporter=tap', 'sample.test.mjs']).status, 1);
  }
  // A hollow file next to a real passing test still blocks passing evidence.
  const mixed = fixture(t); writeFileSync(join(mixed, 'hollow.test.mjs'), "import 'node:test';");
  const m = await run(mixed, { args: ['--test', '--test-reporter=tap', 'hollow.test.mjs', 'sample.test.mjs'] });
  assert.equal(m.tests.counts.passed, 2); assert.equal(m.tests.emptyFiles, 1); assert.equal(m.tests.status, 'not-run');
  assert.equal(verifyLedger(m, { root: mixed }).currentTestEvidence, false);
  const root = fixture(t); mkdirSync(join(root, 'empty'));
  const empty = await run(root, { cwd: 'empty', args: ['--test', '--test-reporter=tap'], artifacts: [] });
  assert.equal(empty.process.exitCode, 0); assert.equal(empty.tests.status, 'no-tests');
  assert.equal(empty.tests.counts.total, 0); assert.equal(verifyLedger(empty, { root }).currentTestEvidence, false);
  // Records created before emptyFiles existed stay consistent but are not current evidence.
  const legacy = await run(fixture(t)); delete legacy.tests.emptyFiles; rehash(legacy);
  assert.equal(verifyLedger(legacy, { root: mixed }).integrity, 'consistent');
  assert.equal(verifyLedger(legacy, { root: mixed }).currentTestEvidence, false);
});
test('skipped-only and todo-only tests are not a passing test run', async t => {
  for (const method of ['skip', 'todo']) {
    const root = fixture(t, `import {test} from 'node:test'; test.${method}('later', () => {});`);
    const r = await run(root);
    assert.equal(r.tests.status, method === 'skip' ? 'skipped-only' : 'not-run');
    assert.equal(verifyLedger(r, { root }).currentTestEvidence, false);
  }
});
test('unknown output, including forged TAP from a non-test command, stays unknown', async t => {
  const root = fixture(t), r = await run(root, { args: ['-e', 'console.log("TAP version 13\\n# tests 1\\n# pass 1\\n# fail 0\\n# cancelled 0\\n# skipped 0\\n# todo 0\\n# duration_ms 1")'] });
  assert.equal(r.process.exitCode, 0); assert.equal(r.tests.status, 'unknown'); assert.equal(r.tests.counts, null);
});
test('default/spec Node output stays unknown instead of guessing counts', async t => {
  const r = await run(fixture(t), { args: ['--test', '--test-reporter=spec', 'sample.test.mjs'] });
  assert.equal(r.tests.status, 'unknown');
});
test('Node flags passed as script arguments cannot authenticate a test-runner invocation', async t => {
  const root = fixture(t);
  writeFileSync(join(root, 'ordinary.mjs'), 'console.log("TAP version 13\\n# tests 1\\n# pass 1\\n# fail 0\\n# cancelled 0\\n# skipped 0\\n# todo 0\\n# duration_ms 1");');
  for (const args of [['ordinary.mjs', '--test', '--test-reporter=tap'], ['--', 'ordinary.mjs', '--test', '--test-reporter=tap']]) {
    const r = await run(root, { args });
    assert.equal(r.process.exitCode, 0); assert.equal(r.tests.status, 'unknown');
    assert.equal(verifyLedger(r, { root }).currentTestEvidence, false);
  }
});
test('launch error is recorded and cannot pass', async t => {
  const root = fixture(t), r = await run(root, { program: 'ledger-nonexistent-program-7612', args: [] });
  assert.equal(r.process.status, 'launch-error'); assert.equal(r.process.exitCode, null);
  assert.equal(r.process.errorCode, 'ENOENT'); assert.equal(r.tests.status, 'incomplete');
  assert.equal(verifyLedger(r, { root }).valid, true);
});
test('direct child timeout is bounded and incomplete', async t => {
  const r = await run(fixture(t), { args: ['-e', 'setTimeout(() => {}, 60000)'], timeoutMs: 200 });
  assert.equal(r.process.status, 'timed-out'); assert.equal(r.process.timedOut, true);
  assert.equal(r.tests.status, 'incomplete'); assert.ok(r.process.durationMs < 5000);
});
test('output limit records bounded prefix hashes and never embeds raw text', async t => {
  const r = await run(fixture(t), { args: ['-e', 'process.stdout.write(String.fromCharCode(80,82,73,86,65,84,69,95,79,85,84,80,85,84).repeat(10000))'], maxOutputBytes: 512 });
  assert.equal(r.process.status, 'output-limit'); assert.equal(r.output.stdout.bytes, 512);
  assert.equal(r.output.hashScope, 'captured-prefixes'); assert.equal(JSON.stringify(r).includes('PRIVATE_OUTPUT'), false);
  const expected = createHash('sha256').update('PRIVATE_OUTPUT'.repeat(10000).slice(0, 512)).digest('hex');
  assert.equal(r.output.stdout.sha256, expected);
});
test('changes after run make a consistent record stale', async t => {
  const root = fixture(t), r = await run(root); writeFileSync(join(root, 'file.txt'), 'after');
  const v = verifyLedger(r, { root }); assert.equal(v.integrity, 'consistent'); assert.equal(v.freshness, 'stale'); assert.equal(v.currentTestEvidence, false);
});
test('file changes during the test are visible even if tests pass', async t => {
  const root = fixture(t, "import {test} from 'node:test'; import {writeFileSync} from 'node:fs'; test('mutates', () => writeFileSync('file.txt','after'));");
  const r = await run(root); assert.equal(r.tests.status, 'passed'); assert.equal(r.artifacts[0].changedDuringRun, true);
  assert.equal(verifyLedger(r, { root }).freshness, 'stale');
});
test('removed artifacts during run leave a usable record with stale evidence', async t => {
  const root = fixture(t, "import {test} from 'node:test'; import {unlinkSync} from 'node:fs'; test('removes', () => unlinkSync('file.txt'));");
  const r = await run(root); assert.equal(r.artifacts[0].afterSha256, null); assert.equal(r.artifacts[0].changedDuringRun, true);
  assert.equal(verifyLedger(r, { root }).freshness, 'stale');
});
test('no artifacts means untracked freshness', async t => {
  const root = fixture(t), r = await run(root, { artifacts: [] });
  assert.equal(verifyLedger(r, { root }).freshness, 'untracked'); assert.equal(verifyLedger(r, { root }).currentTestEvidence, false);
});
test('malformed and contradictory records fail closed even when rehashed', async t => {
  const root = fixture(t), original = await run(root);
  for (const value of [null, {}, [], { schema: 'unknown' }]) assert.equal(verifyLedger(value, { root }).valid, false);
  for (const mutate of [r => r.tests.status = 'failed', r => r.tests.counts.total = 999,
    r => r.process.timedOut = true, r => r.process.outputComplete = false, r => r.process.signal = 'SIGTERM',
    r => r.labels.agent.source = 'observed', r => r.artifacts[0].path = '../secret',
    r => r.output.stdout.bytes = 99999999, r => r.endedAt = '2000-01-01T00:00:00.000Z',
    r => r.signature = {alg: 'ed25519', value: {}}]) {
    const r = structuredClone(original); mutate(r); rehash(r); assert.equal(verifyLedger(r, { root }).valid, false);
  }
  const edited = structuredClone(original); edited.task = 'edited'; assert.equal(verifyLedger(edited, { root }).valid, false);
});
test('signatures reuse upstream Ed25519 and require an explicitly trusted public key', async t => {
  const root = fixture(t), a = generateKeys(), b = generateKeys(), r = signReceipt(await run(root), a.privatePem);
  assert.equal(verifyLedger(r, { root, publicKeyPem: a.publicPem }).signature, 'verified-with-supplied-key');
  assert.equal(verifyLedger(r, { root, publicKeyPem: b.publicPem }).valid, false);
  assert.equal(verifyLedger(r, { root, publicKeyPem: 'bad key' }).valid, false);
  const swapped = verifyLedger(r, { root, publicKeyPem: a.privatePem });
  assert.equal(swapped.valid, false); assert.match(swapped.problems.join(' '), /private key was supplied as the public key/);
  const forged = structuredClone(r); forged.task = 'forged'; rehash(forged);
  assert.equal(verifyLedger(forged, { root, publicKeyPem: a.publicPem }).valid, false);
  assert.equal(verifyLedger(r, { root }).signature, 'not-checked');
  delete r.signature; assert.equal(verifyLedger(r, { root, publicKeyPem: a.publicPem }).valid, false);
});
test('an explicitly supplied empty public key cannot bypass signature verification', async t => {
  const root = fixture(t), keys = generateKeys();
  for (const signed of [false, true]) {
    const r = await run(root);
    if (signed) signReceipt(r, keys.privatePem);
    const v = verifyLedger(r, { root, publicKeyPem: '' });
    assert.equal(v.valid, false); assert.equal(v.signature, 'invalid');
    assert.equal(v.currentTestEvidence, false);
    writeFileSync(join(root, 'record.json'), JSON.stringify(r));
    writeFileSync(join(root, 'empty.pem'), '');
    assert.equal(invoke(root, ['verify', 'record.json', '--pubkey', 'empty.pem']).status, 1);
    const out = `empty-key-${signed}.html`;
    assert.equal(invoke(root, ['report', 'record.json', '--pubkey', 'empty.pem', '--out', out]).status, 1);
    assert.ok(readFileSync(join(root, out), 'utf8').includes('No current passing test evidence'));
  }
});
test('an empty signing key fails before executing the user command', t => {
  const root = fixture(t);
  writeFileSync(join(root, 'empty.pem'), '');
  const result = invoke(root, ['run', '--task', 'must sign', '--sign-key', 'empty.pem', '--out', 'record.json', '--', process.execPath, '-e', 'require("fs").writeFileSync("SENTINEL", "bad")']);
  assert.equal(result.status, 2); assert.match(result.stderr, /not a valid Ed25519 private key PEM/);
  assert.equal(existsSync(join(root, 'SENTINEL')), false);
  assert.equal(existsSync(join(root, 'record.json')), false);
  for (const option of ['--sign-key', '--pubkey']) {
    const args = option === '--sign-key' ? ['run', '--task', 'empty path', option, '', '--', process.execPath] : ['verify', 'record.json', option, ''];
    assert.equal(invoke(root, args).status, 2);
  }
});
test('legacy verification also rejects an explicitly supplied empty public key', t => {
  const root = fixture(t);
  const r = makeReceipt({ task: 'legacy signature request', cwd: root, checks: [['ok', 'node -e "process.exit(0)"']] });
  assert.equal(verifyReceipt(r, { root }).valid, true);
  assert.equal(verifyReceipt(r, { root, publicKeyPem: '' }).valid, false);
});
test('absolute, traversal, Windows drive and secret paths fail before execution', async t => {
  const root = fixture(t);
  writeFileSync(join(root, '.env'), 'secret'); writeFileSync(join(root, 'private.pem'), 'secret'); writeFileSync(join(root, '.npmrc'), 'secret');
  for (const path of ['../secret', '/etc/passwd', 'C:/secret', 'C:secret', '..\\secret', '.env', 'private.pem', '.npmrc']) await assert.rejects(run(root, { artifacts: [path] }));
  writeFileSync(join(root, 'innocent.txt'), '-----BEGIN PRIVATE KEY-----\nsecret');
  await assert.rejects(run(root, { artifacts: ['innocent.txt'] }), /private key/);
  await assert.rejects(run(root, { cwd: '..' }));
});
test('symlink escape and symlink-to-secret are rejected in run and verify', async t => {
  const root = fixture(t), outside = fixture(t); mkdirSync(join(outside, 'data'));
  writeFileSync(join(outside, 'data', 'outside.txt'), 'not allowed');
  // Directory junctions need no developer-mode privilege on Windows.
  symlinkSync(join(outside, 'data'), join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(run(root, { artifacts: ['escape/outside.txt'] }), /escapes root/);
  const r = await run(root); r.artifacts[0].path = 'escape/outside.txt'; rehash(r);
  assert.equal(verifyLedger(r, { root }).freshness, 'stale');
  mkdirSync(join(root, '.aws')); writeFileSync(join(root, '.aws', 'credentials'), 'secret');
  symlinkSync(join(root, '.aws'), join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(run(root, { artifacts: ['alias/credentials'] }), /sensitive/);
});
test('HTML escapes task, arguments, filenames and invalid JSON; no active content', async t => {
  const root = fixture(t), attack = '<script>alert("x")</script>', r = await run(root, { task: attack });
  r.command.args.push(attack); rehash(r);
  const report = renderReport(r, verifyLedger(r, { root }));
  assert.equal(report.includes('<script>'), false); assert.ok(report.includes('&lt;script&gt;'));
  assert.ok(report.includes('default-src')); assert.equal(/<script\b|<iframe\b|<link\b|<img\b|\sonclick=/i.test(report), false);
  const invalid = renderReport({ task: attack }, verifyLedger({ task: attack }));
  assert.equal(invalid.includes('<script>'), false);
});
test('verify and report cannot execute receipt commands, including valid malicious-looking ones', async t => {
  const root = fixture(t), r = await run(root);
  r.command = { program: process.execPath, args: ['-e', 'require("fs").writeFileSync("SENTINEL", "bad")'], shell: false };
  r.tests = { parser: 'unknown', status: 'unknown', counts: null }; rehash(r);
  writeFileSync(join(root, 'record.json'), JSON.stringify(r));
  assert.equal(invoke(root, ['verify', 'record.json']).status, 0);
  assert.equal(invoke(root, ['report', 'record.json', '--out', 'report.html']).status, 0);
  assert.equal(existsSync(join(root, 'SENTINEL')), false);
});
test('CLI refuses existing receipt and report outputs, never reruns the command', async t => {
  const root = fixture(t); writeFileSync(join(root, 'record.json'), 'KEEP');
  const r = invoke(root, ['run', '--task', 'x', '--out', 'record.json', '--', process.execPath, '-e', 'require("fs").writeFileSync("SENTINEL", "bad")']);
  assert.equal(r.status, 2); assert.equal(readFileSync(join(root, 'record.json'), 'utf8'), 'KEEP'); assert.equal(existsSync(join(root, 'SENTINEL')), false);
  writeFileSync(join(root, 'report.html'), 'KEEP');
  assert.equal(invoke(root, ['report', 'record.json', '--out', 'report.html']).status, 2);
  assert.equal(readFileSync(join(root, 'report.html'), 'utf8'), 'KEEP');
});
test('CLI run, verify, report and keygen work end to end; stale returns 1', t => {
  const root = fixture(t);
  assert.equal(invoke(root, ['keygen', '--out-dir', 'keys']).status, 0);
  assert.equal(invoke(root, ['keygen', '--out-dir', 'keys']).status, 2);
  const r = invoke(root, ['run', '--task', 'e2e', '--artifact', 'file.txt', '--agent', 'claude', '--client', 'cli', '--sign-key', 'keys/private.pem', '--out', 'record.json', '--', process.execPath, '--test', '--test-reporter=tap', 'sample.test.mjs']);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(invoke(root, ['verify', 'record.json', '--pubkey', 'keys/public.pem']).status, 0);
  assert.equal(invoke(root, ['report', 'record.json', '--out', 'report.html', '--pubkey', 'keys/public.pem']).status, 0);
  assert.ok(readFileSync(join(root, 'report.html'), 'utf8').includes('class="status ok"'));
  writeFileSync(join(root, 'file.txt'), 'changed');
  assert.equal(invoke(root, ['verify', 'record.json']).status, 1);
  assert.equal(invoke(root, ['report', 'record.json', '--out', 'stale.html']).status, 1);
  const staleHtml = readFileSync(join(root, 'stale.html'), 'utf8');
  assert.ok(staleHtml.includes('No current passing test evidence')); assert.ok(staleHtml.includes('class="status bad"'));
  assert.ok(staleHtml.includes('<li>listed files are stale</li>'));
});
test('CLI exit 0 without tests returns 1 and still writes the receipt', t => {
  const root = fixture(t), result = invoke(root, ['run', '--task', 'unknown', '--out', 'r.json', '--', process.execPath, '-e', 'process.exit(0)']);
  assert.equal(result.status, 1); assert.equal(readReceipt(join(root, 'r.json')).tests.status, 'unknown');
});
test('arguments with shell metacharacters stay literal', async t => {
  const root = fixture(t), arg = 'a & echo BAD > SENTINEL';
  const r = await run(root, { args: ['-e', 'process.stdout.write(process.argv[1])', arg] });
  assert.equal(r.output.stdout.sha256, createHash('sha256').update(arg).digest('hex'));
  assert.equal(existsSync(join(root, 'SENTINEL')), false);
});
test('CLI rejects unknown, duplicate, missing and invalid options', t => {
  const root = fixture(t);
  for (const args of [['run', '--wat', 'x'], ['run', '--task'], ['run', '--task', 'x', '--task', 'y'], ['verify'], ['verify', 'a', 'b'], ['keygen'], ['run', '--task', 'x', '--timeout', '1.5', '--', process.execPath]]) assert.equal(invoke(root, args).status, 2);
});
test('receipt byte and nesting limits reject hostile input before rendering', t => {
  const root = fixture(t);
  writeFileSync(join(root, 'huge.json'), ' '.repeat(1024 * 1024 + 1));
  writeFileSync(join(root, 'deep.json'), '['.repeat(30) + '0' + ']'.repeat(30));
  for (const file of ['huge.json', 'deep.json']) { assert.throws(() => readReceipt(join(root, file)), /limit/); assert.equal(invoke(root, ['report', file, '--out', file + '.html']).status, 2); }
});
test('POSIX FIFOs are rejected without blocking on open', { skip: process.platform === 'win32' ? 'POSIX FIFO unavailable on Windows' : false }, t => {
  const root = fixture(t), fifo = join(root, 'receipt.json');
  const made = spawnSync('mkfifo', [fifo], { encoding: 'utf8' }); assert.equal(made.status, 0, made.stderr);
  const result = invoke(root, ['verify', 'receipt.json']);
  assert.equal(result.error, undefined); assert.equal(result.status, 2); assert.match(result.stderr, /regular file/);
});
test('Git metadata is observed only for the exact supplied project root', async t => {
  const root = fixture(t); const init = spawnSync('git', ['init', root], { encoding: 'utf8' }); assert.equal(init.status, 0);
  const r = await run(root); assert.equal(r.git.status, 'observed'); assert.equal(r.git.dirty, true);
  mkdirSync(join(root, 'nested'));
  const nested = await runLedger({ task: 'nested', root: join(root, 'nested'), program: process.execPath, args: ['-e', 'process.exit(0)'] });
  assert.equal(nested.git.status, 'unavailable');
});
test('Git root detection does not depend on quoting Unicode or spaced paths', async t => {
  const root = fixture(t);
  assert.equal(spawnSync('git', ['init', root], { encoding: 'utf8' }).status, 0);
  const configured = spawnSync('git', ['-C', root, 'config', 'core.quotePath', 'true'], { encoding: 'utf8' });
  assert.equal(configured.status, 0, configured.stderr);
  const r = await run(root);
  assert.equal(r.git.status, 'observed'); assert.equal(r.git.dirty, true);
});
test('Jest and Vitest JSON reports count only when the run writes the named report', async t => {
  const root = fixture(t);
  // Deterministic stand-ins at the recognized entry paths; they write whatever mode.txt says.
  const fake = `const fs = require('fs'); const a = process.argv.slice(2);
const out = (a.find(x => x.startsWith('--outputFile=') || x.startsWith('--outputFile.json=')) || '').split('=')[1];
const [mode, exit] = fs.readFileSync('mode.txt', 'utf8').split(' ');
const counts = { pass: [1, 1, 0], fail: [2, 1, 1], contradict: [1, 0, 1] }[mode];
if (counts) fs.writeFileSync(out, JSON.stringify({ success: mode === 'pass', startTime: Date.now() + Math.random(), numTotalTests: counts[0], numPassedTests: counts[1], numFailedTests: counts[2], numPendingTests: 0, numTodoTests: 0, numFailedTestSuites: counts[2] ? 1 : 0, numTotalTestSuites: 1, testResults: [] }));
process.exit(Number(exit));`;
  for (const p of ['node_modules/jest/bin/jest.js', 'node_modules/vitest/vitest.mjs']) {
    mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), p.endsWith('.mjs') ? `import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);\n${fake}` : fake);
  }
  const jest = ['node_modules/jest/bin/jest.js', '--json', '--outputFile=report.json'];
  const vitest = ['node_modules/vitest/vitest.mjs', 'run', '--reporter=json', '--outputFile=vitest.json'];
  const go = async (mode, args) => { writeFileSync(join(root, 'mode.txt'), mode); return run(root, { args }); };
  const pass = await go('pass 0', jest);
  assert.equal(pass.tests.parser, 'jest-json'); assert.equal(pass.tests.status, 'passed');
  assert.deepEqual(pass.tests.report.path, 'report.json'); assert.equal(verifyLedger(pass, { root }).currentTestEvidence, true);
  assert.equal((await go('fail 1', jest)).tests.status, 'failed');
  // An existing report that the run does not rewrite is never reused.
  const stale = await go('crash 0', jest);
  assert.equal(stale.tests.parser, 'unknown'); assert.equal(verifyLedger(stale, { root }).currentTestEvidence, false);
  assert.equal((await go('contradict 0', jest)).tests.parser, 'unknown');
  const v = await go('pass 0', vitest);
  assert.equal(v.tests.parser, 'vitest-json'); assert.equal(v.tests.status, 'passed');
  assert.equal((await go('pass 0', ['node_modules/vitest/vitest.mjs', '--reporter=json', '--outputFile=w.json'])).tests.parser, 'unknown');
  assert.equal((await go('pass 0', [...jest, '--testResultsProcessor=x'])).tests.parser, 'unknown');
  for (const bad of ['--outputFile=../out.json', '--outputFile=C:/out.json', '--outputFile=.env', '--outputFile=a\b.json'])
    await assert.rejects(go('pass 0', ['node_modules/jest/bin/jest.js', '--json', bad]));
  for (const mutate of [r => r.tests.report.path = 'other.json', r => r.tests.parser = 'vitest-json', r => r.tests.emptyFiles = null, r => r.command.args = r.command.args.filter(a => a !== '--json')]) {
    const r = structuredClone(pass); mutate(r); rehash(r); assert.equal(verifyLedger(r, { root }).valid, false);
  }
  assert.ok(renderReport(pass, verifyLedger(pass, { root })).includes('report.json'));
  assert.ok(renderReport(pass, verifyLedger(pass, { root })).includes(`SHA-256 ${pass.tests.report.sha256}`));
});
const runnerModules = process.env.LEDGER_RUNNER_MODULES;
test('real Jest and Vitest runs are classified from their JSON reports', { skip: !runnerModules && 'set LEDGER_RUNNER_MODULES to a node_modules with jest and vitest' }, async t => {
  const root = fixture(t);
  symlinkSync(resolve(runnerModules), join(root, 'node_modules'), 'junction');
  const cases = {
    'pass.test.cjs': "test('a', () => expect(1).toBe(1));",
    'fail.test.cjs': "test('a', () => expect(1).toBe(2));",
    'empty.test.cjs': '// no tests',
    'skip.test.cjs': "test.skip('later', () => {});",
    'todo.test.cjs': "test.todo('later');",
    'noise.test.cjs': "test('a', () => { process.stdout.write('non-JSON noise'); expect(1).toBe(1); });",
    'pass.test.mjs': "import { test, expect } from 'vitest'; test('a', () => expect(1).toBe(1));",
    'fail.test.mjs': "import { test, expect } from 'vitest'; test('a', () => expect(1).toBe(2));",
    'empty.test.mjs': '// no tests',
    'skip.test.mjs': "import { test } from 'vitest'; test.skip('later', () => {});",
    'todo.test.mjs': "import { test } from 'vitest'; test.todo('later');",
    'noise.test.mjs': "import { test, expect } from 'vitest'; test('a', () => { process.stdout.write('non-JSON noise'); expect(1).toBe(1); });",
  };
  const expected = { pass: ['passed', 1], fail: ['failed', 0], empty: ['failed', 0], skip: ['skipped-only', 0], todo: ['not-run', 0], noise: ['passed', 1] };
  for (const [name, source] of Object.entries(cases)) {
    const dir = name.replace(/\./g, '-'); mkdirSync(join(root, dir)); writeFileSync(join(root, dir, name), source);
    const vitest = name.endsWith('.mjs');
    // Each fixture owns its configuration; never inherit config from a user's parent directory.
    if (!vitest) writeFileSync(join(root, dir, 'jest.config.json'), JSON.stringify({ rootDir: '.', testMatch: ['**/*.test.cjs'] }));
    const args = vitest ? ['../node_modules/vitest/vitest.mjs', 'run', '--reporter=json', '--outputFile=r.json', '--maxWorkers=1']
      : ['../node_modules/jest/bin/jest.js', '--json', '--outputFile=r.json', '--rootDir', '.', '--runInBand'];
    const r = await run(root, { cwd: dir, args, artifacts: [`${dir}/${name}`], timeoutMs: 120000 });
    const [status, passed] = expected[name.split('.')[0]];
    assert.equal(r.tests.parser, vitest ? 'vitest-json' : 'jest-json', name);
    assert.equal(r.tests.status, status, name); assert.equal(r.tests.counts.passed, passed, name);
    assert.equal(verifyLedger(r, { root }).currentTestEvidence, status === 'passed', name);
  }
});
