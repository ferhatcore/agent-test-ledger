// Copyright (c) 2026 Ferhat Kosger. MIT License.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, delimiter, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const source = dirname(fileURLToPath(import.meta.url));
const metadata = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));

function npmCli() {
  const candidates = [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')];
  for (const directory of (process.env.PATH ?? process.env.Path ?? '').split(delimiter)) {
    candidates.push(join(directory, 'node_modules/npm/bin/npm-cli.js'));
    if (process.platform !== 'win32') candidates.push(join(directory, 'npm'));
  }
  for (const path of candidates) {
    if (!path) continue;
    try {
      const actual = realpathSync(path);
      if (actual.endsWith('npm-cli.js')) return actual;
    } catch { /* try the next installed npm location */ }
  }
  throw new Error('package checks require the npm CLI installed with Node.js');
}

function command(program, args, cwd, env = process.env) {
  const r = spawnSync(program, args, { cwd, env, shell: false, windowsHide: true, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024 });
  assert.ifError(r.error);
  assert.equal(r.status, 0, `${program} ${args[0]} failed\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

test('packed archive installs offline and runs signed schema-2 records through its installed CLI', async t => {
  const scratch = mkdtempSync(join(tmpdir(), 'ledger package '));
  t.after(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 3 }));
  const npm = npmCli();
  const packed = JSON.parse(command(process.execPath, [npm, 'pack', '--json', '--ignore-scripts', '--pack-destination', scratch], source));
  assert.equal(packed.length, 1);
  const info = packed[0];
  assert.equal(info.name, metadata.name); assert.equal(info.version, metadata.version);
  const paths = info.files.map(file => file.path);
  for (const path of ['ledger.mjs', 'receipt.mjs', 'lib/execution.mjs', 'lib/windows-job.cs', 'lib/windows-job.ps1', 'lib/client-context.mjs', 'lib/pytest.mjs', 'docs/schema.md', 'validation/RESULTS.md', 'CONTRIBUTING.md', 'LICENSE', 'PROVENANCE.md']) assert.ok(paths.includes(path), `archive contains ${path}`);
  assert.ok(paths.every(path => !path.startsWith('/') && !path.split('/').includes('..')));
  const archive = join(scratch, info.filename), prefix = join(scratch, 'installed');
  command(process.execPath, [npm, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', prefix, archive], scratch);
  const installed = join(prefix, 'node_modules', metadata.name);
  const pkg = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
  assert.equal(pkg.version, metadata.version);
  assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0);
  for (const path of paths.filter(path => /\.md$/i.test(path))) {
    const file = join(installed, path), text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].split('#')[0];
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
      const destination = resolve(dirname(file), decodeURIComponent(target));
      const fromRoot = relative(installed, destination);
      assert.ok(fromRoot !== '..' && !fromRoot.startsWith('..' + sep), `${path}: link remains inside package`);
      assert.ok(existsSync(destination), `${path}: local link ${target} exists in installed package`);
    }
  }
  const cli = join(installed, pkg.bin['agent-test-ledger']);
  assert.equal(command(process.execPath, [cli, '--version'], scratch).trim(), metadata.version);
  assert.ok(command(process.execPath, [cli, '--help'], scratch).includes(`Agent Test Ledger ${metadata.version}`));
  assert.ok(existsSync(join(prefix, 'node_modules', '.bin', process.platform === 'win32' ? 'agent-test-ledger.cmd' : 'agent-test-ledger')));
  // npm exec resolves the installed bin mapping without a shell or registry lookup.
  assert.equal(command(process.execPath, [npm, 'exec', '--offline', '--prefix', prefix, '--', 'agent-test-ledger', '--version'], scratch).trim(), metadata.version);

  writeFileSync(join(scratch, 'sample.test.mjs'), "import {test} from 'node:test';import assert from 'node:assert/strict';test('installed package',()=>assert.equal(2+2,4));\n");
  writeFileSync(join(scratch, 'context.json'), JSON.stringify({ session_id: 'package-session', cwd: scratch, hook_event_name: 'SessionStart', source: 'startup', transcript_path: '/private/transcript', model: 'private-model' }));
  command(process.execPath, [cli, 'keygen', '--out-dir', 'keys'], scratch);
  const scope = ['linux', 'win32'].includes(process.platform) ? [] : ['--process-scope', 'direct'];
  command(process.execPath, [cli, 'run', '--task', 'Package <smoke> & record', '--client-context', 'context.json', '--artifact', 'sample.test.mjs', '--sign-key', 'keys/private.pem', '--out', 'record.json', ...scope, '--', 'node', '--test', '--test-reporter=tap', 'sample.test.mjs'], scratch, { ...process.env, CLAUDECODE: '1' });
  const record = JSON.parse(readFileSync(join(scratch, 'record.json'), 'utf8'));
  assert.equal(record.schema, 'agent-test-ledger/2');
  assert.equal(record.tests.status, 'passed'); assert.equal(record.tests.counts.passed, 1);
  assert.equal(record.processControl.scope, scope.length ? 'direct' : 'tree');
  assert.equal(record.processControl.strategy, process.platform === 'win32' ? 'windows-job' : process.platform === 'linux' ? 'posix-process-group' : 'direct-child');
  assert.equal(record.processControl.cleanup.status, 'confirmed');
  assert.equal(record.observations.authenticated, false);
  assert.equal(record.observations.hook.event, 'SessionStart');
  assert.deepEqual(record.observations.environment, [{ source: 'environment', name: 'CLAUDECODE', value: '1' }]);
  const observations = JSON.stringify(record.observations);
  for (const value of ['package-session', scratch, '/private/transcript', 'private-model']) assert.equal(observations.includes(value), false);
  const verified = JSON.parse(command(process.execPath, [cli, 'verify', 'record.json', '--pubkey', 'keys/public.pem'], scratch));
  assert.equal(verified.valid, true); assert.equal(verified.currentTestEvidence, true);
  assert.equal(verified.signature, 'verified-with-supplied-key');
  command(process.execPath, [cli, 'report', 'record.json', '--pubkey', 'keys/public.pem', '--out', 'record.html'], scratch);
  const html = readFileSync(join(scratch, 'record.html'), 'utf8');
  assert.ok(html.includes('Package &lt;smoke&gt; &amp; record'));
  assert.equal(html.includes('Package <smoke>'), false);
  assert.ok(html.includes('Process control'));
  const legacy = JSON.parse(command(process.execPath, [cli, 'verify', 'examples/greeting.json', '--root', installed], installed));
  assert.equal(legacy.valid, true); assert.equal(legacy.currentTestEvidence, true);
  const example = JSON.parse(command(process.execPath, [cli, 'verify', 'examples/greeting-v2.json', '--root', installed], installed));
  assert.equal(example.valid, true); assert.equal(example.currentTestEvidence, true);
});
