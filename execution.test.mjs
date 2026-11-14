// Copyright (c) 2026 Ferhat Kosger. MIT License.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, linkSync, copyFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { execute } from './lib/execution.mjs';
import { runLedger, verifyLedger } from './lib/ledger.mjs';
import { selfHashOf } from './receipt.mjs';

const supported = ['linux', 'win32'].includes(process.platform);
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = b => createHash('sha256').update(b).digest('hex');
const cli = resolve('ledger.mjs');
const execution = pathToFileURL(resolve('lib/execution.mjs')).href;
const controllers = new Map();
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'ledger tree ü '));
  controllers.set(root, []);
  t.after(async () => {
    for (const child of controllers.get(root)) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM'); await pause(500);
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }
    }
    // A failed assertion must not leave test processes behind. Confirm the
    // unique absolute fixture script in the live command line before using a
    // recorded PID, so a recycled PID cannot target an unrelated process.
    for (const role of ['root', 'child', 'grandchild']) {
      const path = join(root, role + '.pid'); if (!existsSync(path)) continue;
      const pid = Number(readFileSync(path, 'utf8'));
      if (!Number.isInteger(pid) || pid < 1 || !live(pid)) continue;
      let command = '';
      if (process.platform === 'linux') {
        try { command = readFileSync(`/proc/${pid}/cmdline`, 'utf8'); } catch { /* already gone */ }
      } else if (process.platform === 'win32') {
        command = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`], { encoding: 'utf8', windowsHide: true, timeout: 5000 }).stdout ?? '';
      }
      if (command.includes(join(root, 'tree.cjs'))) { try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ } }
    }
    controllers.delete(root);
    await pause(50); rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  });
  return root;
}
async function waitFor(check, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (check()) return; await pause(20); }
  assert.fail('condition did not become true within bound');
}
function live(pid) {
  try {
    if (process.platform === 'linux') {
      const s = readFileSync(`/proc/${pid}/stat`, 'utf8');
      return !['Z', 'X', 'x'].includes(s.slice(s.lastIndexOf(')') + 2).split(' ')[0]);
    }
    process.kill(pid, 0); return true;
  } catch (e) { if (['ENOENT', 'ESRCH'].includes(e.code)) return false; throw e; }
}
function tree(root, mode) {
  writeFileSync(join(root, 'tree.cjs'), `
const fs = require('fs'), {spawn} = require('child_process');
const role = process.argv[2] || 'root', mode = process.argv[3];
fs.writeFileSync(role + '.pid', String(process.pid));
if (mode === 'resist') process.on('SIGTERM', () => {});
if (role === 'root' || role === 'child') spawn(process.execPath, [__filename, role === 'root' ? 'child' : 'grandchild', mode], {stdio:'inherit'});
if (role !== 'root') {
  fs.writeFileSync(role + '.ready', 'ready');
  const arming = setInterval(() => {
    if (!fs.existsSync('arm.json')) return;
    const {deadline} = JSON.parse(fs.readFileSync('arm.json', 'utf8'));
    if (!Number.isSafeInteger(deadline)) return;
    clearInterval(arming);
    setTimeout(() => fs.writeFileSync(role + '.sentinel', 'still executing'), Math.max(0, deadline - Date.now()));
    fs.writeFileSync(role + '.armed.tmp', String(deadline));
    fs.renameSync(role + '.armed.tmp', role + '.armed');
  }, 10);
}
if (role === 'root') {
  const timer = setInterval(() => {
    if (!fs.existsSync('child.ready') || !fs.existsSync('grandchild.ready')) return;
    fs.writeFileSync('ready', 'yes');
    if (!fs.existsSync('child.armed') || !fs.existsSync('grandchild.armed')) return;
    clearInterval(timer); fs.writeFileSync('all-armed', 'yes');
    if (mode === 'normal') process.exit(0);
    if (mode === 'overflow') process.stdout.write('x'.repeat(131072));
  }, 10);
}
setInterval(() => {}, 1000);
`);
  return { program: process.execPath, args: [join(root, 'tree.cjs'), 'root', mode] };
}
async function armTree(root, delayMs = 4000) {
  await waitFor(() => existsSync(join(root, 'ready')));
  for (const role of ['root', 'child', 'grandchild']) {
    assert.equal(live(Number(readFileSync(join(root, role + '.pid'), 'utf8'))), true, role + ' was executing before arming');
  }
  const deadline = Date.now() + delayMs;
  writeFileSync(join(root, 'arm.tmp'), JSON.stringify({ deadline }));
  renameSync(join(root, 'arm.tmp'), join(root, 'arm.json'));
  await waitFor(() => existsSync(join(root, 'all-armed')));
  for (const role of ['child', 'grandchild']) assert.equal(Number(readFileSync(join(root, role + '.armed'), 'utf8')), deadline);
}
async function assertTreeStopped(root) {
  assert.equal(existsSync(join(root, 'all-armed')), true, 'both executing descendants armed their delayed side effects');
  for (const role of ['root', 'child', 'grandchild']) {
    const pid = Number(readFileSync(join(root, role + '.pid'), 'utf8'));
    await waitFor(() => !live(pid), 6000);
  }
  const deadline = Math.max(...['child', 'grandchild'].map(role => Number(readFileSync(join(root, role + '.armed'), 'utf8'))));
  await pause(Math.max(0, deadline + 150 - Date.now()));
  for (const role of ['child', 'grandchild']) assert.equal(existsSync(join(root, role + '.sentinel')), false, role + ' did not execute its delayed side effect');
}

test('managed execution preserves literal Unicode argv, binary streams and root exit code', { skip: !supported }, async t => {
  const root = fixture(t), args = ['', 'plain', 'two words', 'quote"value', '\\', '\\\\', 'tail\\', 'space tail\\', 'a\\"b', 'ü😀', '$(echo no)', '& | >'];
  const r = await execute({ program: process.execPath, args: ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', ...args] }, root, 10000, 8192);
  assert.equal(r.process.status, 'completed'); assert.equal(r.process.exitCode, 0);
  assert.deepEqual(JSON.parse(r.stdout), args); assert.equal(r.processControl.cleanup.status, 'confirmed');
  const out = Buffer.from([0, 1, 10, 13, 27, 65, 127, 128, 195, 255]), err = Buffer.from([255, 0, 13, 10, 69, 82, 82, 128]);
  const b = await execute({ program: process.execPath, args: ['-e', `process.stdout.write(Buffer.from(${JSON.stringify([...out])}));process.stderr.write(Buffer.from(${JSON.stringify([...err])}));process.exit(259)`] }, root, 10000, 8192);
  assert.equal(b.process.exitCode, process.platform === 'win32' ? 259 : 3);
  assert.deepEqual(b.output.stdout, { bytes: out.length, sha256: sha(out) });
  assert.deepEqual(b.output.stderr, { bytes: err.length, sha256: sha(err) });
  assert.equal(b.process.outputComplete, true);
  const stdin = await execute({ program: process.execPath, args: ['-e', "let n=0;process.stdin.on('data',b=>n+=b.length);process.stdin.on('end',()=>console.log(n));process.stdin.resume();"] }, root, 10000, 1024);
  assert.equal(stdin.stdout.trim(), '0');
  if (process.platform === 'win32') {
    const high = await execute({ program: process.execPath, args: ['-e', 'process.exit(0xf1234567)'] }, root, 10000, 1024);
    assert.equal(high.process.exitCode, 0xf1234567);
  }
});

test('Windows dotted executable names resolve their explicit exe candidate', { skip: process.platform !== 'win32' }, async t => {
  const root = fixture(t), target = join(root, 'tool.v1.exe');
  try { linkSync(process.execPath, target); } catch { copyFileSync(process.execPath, target); }
  const r = await execute({ program: join(root, 'tool.v1'), args: ['-e', "console.log('resolved')"] }, root, 10000, 1024);
  assert.equal(r.process.status, 'completed'); assert.equal(r.process.exitCode, 0); assert.equal(r.stdout.trim(), 'resolved');
  const blocked = await execute({ program: 'no-shell.cmd', args: [] }, root, 10000, 1024);
  assert.equal(blocked.process.status, 'launch-error'); assert.equal(blocked.process.errorCode, 'UNSUPPORTED_EXECUTABLE');
  assert.equal(blocked.processControl.cleanup.status, 'not-started');
});

test('maximum accepted Windows timeout does not overflow its control watchdog', { skip: process.platform !== 'win32' }, async t => {
  const root = fixture(t), warnings = [], warning = w => { if (w.name === 'TimeoutOverflowWarning') warnings.push(w); };
  process.on('warning', warning);
  try {
    const r = await execute({ program: process.execPath, args: ['-e', "setTimeout(()=>console.log('finished'),500)"] }, root, 2147483647, 1024);
    assert.equal(r.process.status, 'completed'); assert.equal(r.process.exitCode, 0); assert.equal(r.stdout.trim(), 'finished');
    assert.equal(r.processControl.cleanup.status, 'confirmed'); assert.deepEqual(warnings, []);
  } finally { process.removeListener('warning', warning); }
});

for (const mode of ['normal', 'timeout', 'overflow', 'resist']) {
  test(`managed tree stops real child and grandchild: ${mode}`, { skip: !supported }, async t => {
    const root = fixture(t), command = tree(root, mode);
    const timeout = ['timeout', 'resist'].includes(mode), running = execute(command, root, timeout ? 5000 : 15000, 1024);
    await armTree(root, timeout ? 8000 : 4000);
    const r = await running;
    assert.equal(r.process.status, mode === 'normal' ? 'completed' : mode === 'overflow' ? 'output-limit' : 'timed-out');
    assert.equal(r.processControl.scope, 'tree'); assert.equal(r.processControl.cleanup.status, 'confirmed');
    if (mode === 'normal') { assert.equal(r.process.exitCode, 0); assert.equal(r.process.outputComplete, true); }
    else assert.equal(r.process.outputComplete, false);
    await assertTreeStopped(root);
  });
}

test('interruption event requests managed cleanup and returns an incomplete result', { skip: !supported }, async t => {
  // This checks the JS cancellation path. A real OS SIGINT is tested separately
  // on POSIX; Windows process.kill(SIGINT) is not console Ctrl+C delivery.
  const root = fixture(t), command = tree(root, 'resist');
  const running = execute(command, root, 20000, 1024);
  await armTree(root);
  process.emit('SIGINT');
  const r = await running;
  assert.equal(r.process.status, 'interrupted'); assert.equal(r.processControl.cleanup.status, 'confirmed');
  await assertTreeStopped(root);
});

test('actual POSIX CLI SIGINT writes an interrupted record after group cleanup', { skip: process.platform !== 'linux' }, async t => {
  const root = fixture(t), command = tree(root, 'resist');
  const child = spawn(process.execPath, [cli, 'run', '--task', 'Interrupt', '--out', 'record.json', '--', command.program, ...command.args], { cwd: root, stdio: 'ignore' });
  controllers.get(root).push(child);
  const exited = new Promise(resolve => child.once('exit', code => resolve(code)));
  await armTree(root);
  child.kill('SIGINT'); assert.equal(await exited, 1);
  const r = JSON.parse(readFileSync(join(root, 'record.json'), 'utf8'));
  assert.equal(r.process.status, 'interrupted'); assert.equal(r.processControl.cleanup.status, 'confirmed');
  assert.equal(verifyLedger(r, { root }).valid, true); await assertTreeStopped(root);
});

test('Windows controller death closes its managed job and stops descendants', { skip: process.platform !== 'win32' }, async t => {
  const root = fixture(t), command = tree(root, 'resist');
  writeFileSync(join(root, 'controller.mjs'), `import {execute} from ${JSON.stringify(execution)}; await execute(${JSON.stringify(command)},process.cwd(),60000,1024);`);
  const child = spawn(process.execPath, ['controller.mjs'], { cwd: root, stdio: 'ignore' });
  controllers.get(root).push(child);
  await armTree(root);
  const exited = new Promise(resolve => child.once('exit', resolve)); child.kill('SIGKILL'); await exited;
  await assertTreeStopped(root);
});

test('Windows helper death kills its job but remains unconfirmed evidence', { skip: process.platform !== 'win32' }, async t => {
  const root = fixture(t), command = tree(root, 'resist');
  writeFileSync(join(root, 'controller.mjs'), `import {execute} from ${JSON.stringify(execution)};import {writeFileSync} from 'node:fs'; const r=await execute(${JSON.stringify(command)},process.cwd(),60000,1024);writeFileSync('result.json',JSON.stringify(r));`);
  const child = spawn(process.execPath, ['controller.mjs'], { cwd: root, stdio: 'ignore' });
  controllers.get(root).push(child);
  await waitFor(() => existsSync(join(root, 'ready')));
  // Query only this controller's immediate child, never unrelated processes.
  const found = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${child.pid}' | Where-Object Name -eq 'powershell.exe').ProcessId`], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
  assert.equal(found.status, 0); const pid = Number(found.stdout.trim()); assert.ok(Number.isInteger(pid) && pid > 0);
  await armTree(root);
  process.kill(pid, 'SIGKILL');
  await waitFor(() => existsSync(join(root, 'result.json')));
  const r = JSON.parse(readFileSync(join(root, 'result.json'), 'utf8'));
  assert.equal(r.process.status, 'control-error'); assert.equal(r.processControl.cleanup.status, 'unconfirmed');
  await assertTreeStopped(root);
});

test('direct scope is explicit, launch errors never downgrade and cleanup evidence is validated', { skip: !supported }, async t => {
  const root = fixture(t); writeFileSync(join(root, 'sample.test.mjs'), "import {test} from 'node:test';test('ok',()=>{});"); writeFileSync(join(root, 'file.txt'), 'same');
  const options = { task: 'Scope', root, program: process.execPath, args: ['--test', '--test-reporter=tap', 'sample.test.mjs'], artifacts: ['file.txt'] };
  const direct = await runLedger({ ...options, processScope: 'direct' });
  assert.deepEqual(direct.processControl, { scope: 'direct', strategy: 'direct-child', cleanup: { status: 'confirmed', errorCode: null } });
  assert.equal(verifyLedger(direct, { root }).currentTestEvidence, true);
  const managed = await runLedger(options); assert.equal(managed.processControl.scope, 'tree');
  for (const cleanup of ['unconfirmed', 'failed']) {
    const r = structuredClone(managed); r.processControl.cleanup = { status: cleanup, errorCode: 'CLEANUP_ERROR' }; r.selfHash = selfHashOf(r);
    assert.equal(verifyLedger(r, { root }).valid, true); assert.equal(verifyLedger(r, { root }).currentTestEvidence, false);
  }
  for (const mutate of [r => delete r.processControl, r => r.processControl.scope = 'other', r => r.processControl.strategy = 'direct-child',
    r => r.processControl.cleanup.status = 'not-started', r => r.processControl.cleanup.errorCode = 'bad path /private', r => r.processControl.extra = true]) {
    const r = structuredClone(managed); mutate(r); r.selfHash = selfHashOf(r); assert.equal(verifyLedger(r, { root }).valid, false);
  }
  const missing = await runLedger({ ...options, program: 'ledger-missing-command-268391', args: [] });
  assert.equal(missing.process.status, 'launch-error'); assert.equal(missing.process.errorCode, 'ENOENT');
  assert.equal(missing.processControl.scope, 'tree'); assert.equal(missing.processControl.cleanup.status, 'not-started');
  assert.equal(verifyLedger(missing, { root }).valid, true);
  await assert.rejects(runLedger({ ...options, processScope: 'fallback' }), /process scope/);
});

test('direct scope confirms only its child and bounds pipes held by descendants', { skip: process.platform !== 'linux' }, async t => {
  const root = fixture(t), command = tree(root, 'normal');
  const running = execute(command, root, 15000, 1024, 'direct');
  await armTree(root);
  const r = await running;
  assert.equal(r.process.status, 'completed'); assert.equal(r.process.exitCode, 0);
  assert.equal(r.process.outputComplete, false); assert.equal(r.output.hashScope, 'captured-prefixes');
  assert.deepEqual(r.processControl, { scope: 'direct', strategy: 'direct-child', cleanup: { status: 'confirmed', errorCode: null } });
  assert.equal(live(Number(readFileSync(join(root, 'child.pid'), 'utf8'))), true);
  assert.equal(live(Number(readFileSync(join(root, 'grandchild.pid'), 'utf8'))), true);
  // fixture cleanup verifies the unique command line before stopping these two
  // intentionally surviving test descendants.
});
