// Copyright (c) 2026 Ferhat Kosger. MIT License.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runLedger, verifyLedger } from './lib/ledger.mjs';
import { observeClientContext, MAX_CLIENT_CONTEXT, HOOK_EVENTS } from './lib/client-context.mjs';
import { digest } from './lib/files.mjs';
import { renderReport } from './lib/report.mjs';
import { selfHashOf, generateKeys, signReceipt } from './receipt.mjs';

const cli = resolve('ledger.mjs');
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'ledger context ü '));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3 }));
  writeFileSync(join(root, 'sample.test.mjs'), "import {test} from 'node:test'; test('ok', () => {});");
  writeFileSync(join(root, 'file.txt'), 'stable');
  return root;
}
const run = (root, extra = {}) => runLedger({ task: 'Context test', root, program: process.execPath,
  args: ['--test', '--test-reporter=tap', 'sample.test.mjs'], artifacts: ['file.txt'], ...extra });
const rehash = r => { r.selfHash = selfHashOf(r); return r; };
const input = extra => ({ session_id: 'private-session-ü-42', cwd: '/private/working-directory', hook_event_name: 'PostToolUse', ...extra });
function environment(t) {
  const names = ['CLAUDECODE', 'CLAUDE_PLUGIN_ROOT', 'CODEX_THREAD_ID', 'CLAUDE_CODE_ENTRYPOINT'];
  const previous = names.map(n => process.env[n]);
  t.after(() => names.forEach((n, i) => previous[i] === undefined ? delete process.env[n] : process.env[n] = previous[i]));
  names.forEach(n => delete process.env[n]);
}

test('only the exact documented environment marker is observed, never inferred identity', async t => {
  environment(t);
  const root = fixture(t);
  assert.deepEqual(observeClientContext(root), { authenticated: false, environment: [], hook: null });
  process.env.CLAUDE_PLUGIN_ROOT = '/shared/plugin'; process.env.CODEX_THREAD_ID = 'thread'; process.env.CLAUDE_CODE_ENTRYPOINT = 'cli';
  for (const value of ['', '0', 'true', '01', '1 ', '2']) {
    process.env.CLAUDECODE = value;
    assert.deepEqual(observeClientContext(root).environment, []);
  }
  process.env.CLAUDECODE = '1';
  const r = await run(root, { agent: 'codex', client: 'desktop' });
  assert.equal(r.schema, 'agent-test-ledger/2');
  assert.deepEqual(r.observations, { authenticated: false, environment: [{ source: 'environment', name: 'CLAUDECODE', value: '1' }], hook: null });
  assert.deepEqual(r.labels, { agent: { value: 'codex', source: 'user-supplied' }, client: { value: 'desktop', source: 'user-supplied' } });
  assert.equal(verifyLedger(r, { root }).currentTestEvidence, true);
  const unknown = await run(root, { args: ['-e', ''] });
  assert.equal(verifyLedger(unknown, { root }).currentTestEvidence, false);
});

test('hook observations store only bounded event and fingerprints, not private input fields', async t => {
  const root = fixture(t), hook = input({ transcript_path: '/private/transcript.jsonl', model: 'private-model', tool_input: { command: 'private tool command' } });
  const bytes = Buffer.from(JSON.stringify(hook)); writeFileSync(join(root, 'context.json'), bytes);
  const r = await run(root, { clientContext: 'context.json' });
  assert.deepEqual(r.observations.hook, { source: 'hook-input', sha256: digest(bytes), bytes: bytes.length, event: 'PostToolUse', sessionSha256: digest(hook.session_id) });
  assert.equal(r.labels.agent.value, 'other'); assert.equal(r.labels.client.value, 'unknown');
  const html = renderReport(r, verifyLedger(r, { root }));
  for (const privateValue of [hook.session_id, hook.cwd, hook.transcript_path, hook.model, hook.tool_input.command, 'context.json']) {
    assert.equal(JSON.stringify(r).includes(privateValue), false); assert.equal(html.includes(privateValue), false);
  }
  assert.match(html, /Client observations \(unauthenticated\)/);
  const first = r.observations.hook.sessionSha256;
  for (const event of HOOK_EVENTS) {
    writeFileSync(join(root, 'context.json'), JSON.stringify(input({ hook_event_name: event })));
    const observed = observeClientContext(root, 'context.json');
    assert.equal(observed.hook.event, event); assert.equal(observed.hook.sessionSha256, first);
  }
});

test('malformed, oversized, deeply nested and forged hook input is rejected before launch', async t => {
  const root = fixture(t), sentinel = join(root, 'ran.txt');
  const invalid = [null, [], {}, input({ session_id: '' }), input({ session_id: '   ' }), input({ session_id: 'x'.repeat(1025) }), input({ session_id: 1 }), input({ session_id: '\ud800' }),
    input({ session_id: 'a\nb' }), input({ cwd: null }), input({ cwd: 'x'.repeat(8193) }), input({ hook_event_name: 'Unknown' }), input({ hook_event_name: '<script>' }),
    input({ authenticated: true }), input({ source: 'authenticated-client' }), input({ client: 'desktop' }),
    input({ payload: JSON.parse('['.repeat(17) + '0' + ']'.repeat(17)) })];
  const raw = [...invalid.map(x => JSON.stringify(x)), '{broken', Buffer.from([0xff]), '\ufeff' + JSON.stringify(input()), ' '.repeat(MAX_CLIENT_CONTEXT + 1)];
  for (const data of raw) {
    writeFileSync(join(root, 'context.json'), data);
    await assert.rejects(run(root, { clientContext: 'context.json', args: ['-e', "require('fs').writeFileSync('ran.txt','yes')"] }), /client context/);
    assert.equal(existsSync(sentinel), false);
  }
});

test('documented SessionStart sources are accepted and discarded with other private event fields', async t => {
  const root = fixture(t);
  for (const source of ['startup', 'resume', 'clear', 'compact', 'fork']) {
    const hook = input({ hook_event_name: 'SessionStart', source, transcript_path: '/private/session-transcript.jsonl',
      model: 'private-session-model', agent_id: 'private-agent-id', agent_type: 'private-agent-type', permission_mode: 'default' });
    const bytes = Buffer.from(JSON.stringify(hook)); writeFileSync(join(root, 'context.json'), bytes);
    const r = await run(root, { clientContext: 'context.json' });
    assert.deepEqual(r.observations.hook, { source: 'hook-input', sha256: digest(bytes), bytes: bytes.length, event: 'SessionStart', sessionSha256: digest(hook.session_id) });
    assert.equal(verifyLedger(r, { root }).currentTestEvidence, true);
    const html = renderReport(r, verifyLedger(r, { root }));
    for (const privateValue of [source, hook.session_id, hook.cwd, hook.transcript_path, hook.model, hook.agent_id, hook.agent_type, 'permission_mode']) {
      assert.equal(JSON.stringify(r).includes(privateValue), false); assert.equal(html.includes(privateValue), false);
    }
  }
  // A common-field-only input remains supported; a supplied source must be valid.
  writeFileSync(join(root, 'context.json'), JSON.stringify(input({ hook_event_name: 'SessionStart' })));
  assert.equal(observeClientContext(root, 'context.json').hook.event, 'SessionStart');
  for (const source of ['authenticated-client', 'STARTUP', '', null, 1, {}]) {
    writeFileSync(join(root, 'context.json'), JSON.stringify(input({ hook_event_name: 'SessionStart', source })));
    await assert.rejects(run(root, { clientContext: 'context.json', args: ['-e', "require('fs').writeFileSync('ran.txt','yes')"] }), /client context/);
    assert.equal(existsSync(join(root, 'ran.txt')), false);
  }
  for (const hook_event_name of ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']) {
    writeFileSync(join(root, 'context.json'), JSON.stringify(input({ hook_event_name, source: 'startup' })));
    assert.throws(() => observeClientContext(root, 'context.json'), /client context/);
  }
});

test('context paths are relative to root, bounded and sensitive-target safe before execution', async t => {
  const root = fixture(t); mkdirSync(join(root, 'sub')); mkdirSync(join(root, '.claude'));
  writeFileSync(join(root, 'context.json'), JSON.stringify(input()));
  writeFileSync(join(root, '.claude', 'context.json'), JSON.stringify(input()));
  for (const path of ['../context.json', resolve(root, 'context.json'), 'sub/../context.json', '.claude/context.json', '.env', 'missing.json', 'sub']) {
    await assert.rejects(run(root, { clientContext: path, args: ['-e', "require('fs').writeFileSync('ran.txt','yes')"] }), /client context/);
    assert.equal(existsSync(join(root, 'ran.txt')), false);
  }
  const r = await run(root, { cwd: 'sub', clientContext: 'context.json', args: ['-e', ''] });
  assert.equal(r.observations.hook.event, 'PostToolUse');
  try { symlinkSync(join(root, '.claude'), join(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (e) { if (!['EPERM', 'EACCES', 'ENOTSUP'].includes(e.code)) throw e; t.diagnostic('symlink creation unavailable; sensitive symlink check not executed'); return; }
  await assert.rejects(run(root, { clientContext: 'alias/context.json' }), /client context/);
});

test('schema 2 rejects forged observation shapes even when rehashed and legacy schema stays compatible', async t => {
  const root = fixture(t); writeFileSync(join(root, 'context.json'), JSON.stringify(input()));
  const original = await run(root, { clientContext: 'context.json' });
  for (const mutate of [r => delete r.observations, r => r.observations.authenticated = true,
    r => r.observations.client = 'desktop', r => r.observations.environment = [{ source: 'environment', name: 'CODEX_THREAD_ID', value: 'x' }],
    r => r.observations.environment = [{ source: 'environment', name: 'CLAUDECODE', value: '0' }],
    r => r.observations.environment = Array(2).fill({ source: 'environment', name: 'CLAUDECODE', value: '1' }),
    r => r.observations.hook.source = 'verified-client', r => r.observations.hook.bytes = MAX_CLIENT_CONTEXT + 1,
    r => r.observations.hook.event = 'Unknown', r => r.observations.hook.sessionSha256 = 'raw-session',
    r => r.observations.hook.transcript_path = '/private', r => r.schema = 'agent-test-ledger/1']) {
    const r = structuredClone(original); mutate(r); rehash(r);
    assert.equal(verifyLedger(r, { root }).valid, false);
  }
  const tampered = structuredClone(original); tampered.observations.hook.sha256 = 'a'.repeat(64);
  assert.equal(verifyLedger(tampered, { root }).valid, false);
  const legacy = structuredClone(original); legacy.schema = 'agent-test-ledger/1'; delete legacy.observations; rehash(legacy);
  assert.equal(verifyLedger(legacy, { root }).currentTestEvidence, true);
  const { privatePem, publicPem } = generateKeys(); signReceipt(legacy, privatePem);
  assert.equal(verifyLedger(legacy, { root, publicKeyPem: publicPem }).signature, 'verified-with-supplied-key');
  assert.match(renderReport(legacy, verifyLedger(legacy, { root })), /not recorded \(schema 1\)/);
  const old = structuredClone(legacy); delete old.signature; delete old.tests.emptyFiles; rehash(old);
  assert.equal(verifyLedger(old, { root }).valid, true); assert.equal(verifyLedger(old, { root }).currentTestEvidence, false);
  signReceipt(original, privatePem);
  assert.equal(verifyLedger(original, { root, publicKeyPem: publicPem }).signature, 'verified-with-supplied-key');
});

test('CLI validates optional context before launch and escapes invalid observations in reports', t => {
  const root = fixture(t); writeFileSync(join(root, 'context.json'), JSON.stringify(input()));
  const args = ['run', '--task', 'CLI context', '--client-context', 'context.json', '--out', 'record.json', '--', process.execPath, '--test', '--test-reporter=tap', 'sample.test.mjs'];
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 0, result.stderr); assert.equal(existsSync(join(root, 'record.json')), true);
  writeFileSync(join(root, 'context.json'), '{}');
  const invalid = spawnSync(process.execPath, [cli, 'run', '--task', 'invalid', '--client-context', 'context.json', '--out', 'invalid.json', '--', process.execPath, '-e', "require('fs').writeFileSync('ran.txt','yes')"], { cwd: root, encoding: 'utf8', timeout: 15000 });
  assert.equal(invalid.status, 2); assert.equal(existsSync(join(root, 'ran.txt')), false); assert.equal(existsSync(join(root, 'invalid.json')), false);
  const unsafe = { observations: { hook: { event: '<script>alert(1)</script>' } } };
  const html = renderReport(unsafe, verifyLedger(unsafe, { root }));
  assert.equal(html.includes('<script>'), false); assert.match(html, /&lt;script&gt;/);
});
