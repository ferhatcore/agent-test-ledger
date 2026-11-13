// Copyright (c) 2026 Ferhat Kosger. MIT License.
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { basename, relative, resolve, sep } from 'node:path';
import { realpathSync, statSync, lstatSync } from 'node:fs';
import { selfHashOf, signatureProblem } from '../receipt.mjs';
import { snapshot, safeArtifact, sensitivePath, boundedRead, digest, relativePath, MAX_RECEIPT } from './files.mjs';
import { jsonRunner, linkedPath, parseRunnerReport, MAX_REPORT } from './runners.mjs';

export const SCHEMA = 'agent-test-ledger/1';
const integer = x => Number.isSafeInteger(x) && x >= 0;
const hash = x => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x);
const text = (x, max = 8192) => typeof x === 'string' && x.length <= max && !x.includes('\0');
const oneOf = (x, values) => values.includes(x);
const date = x => typeof x === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x) && Number.isFinite(Date.parse(x));

function isNodeTap(command) {
  const args = command.args;
  if (!/^node(?:\.exe)?$/i.test(basename(command.program))) return false;
  let test = false, tap = false, reporters = 0;
  // Node options must precede the entrypoint/-- separator. Script arguments are not runtime flags.
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--' || !a.startsWith('-')) break;
    if (/^(?:--test-reporter-destination|--watch|--eval|--print|--run|-e|-p)/.test(a)) return false;
    if (a === '--test') test = true;
    else if (a === '--test-reporter') { reporters++; tap = args[++i] === 'tap'; }
    else if (a.startsWith('--test-reporter=')) { reporters++; tap = a === '--test-reporter=tap'; }
    // Unknown value-taking options are conservatively unsupported rather than guessed.
    else if (!/^--test-(?:only|force-exit)$|^--test-(?:name-pattern|skip-pattern|concurrency|timeout|isolation)=/.test(a)) return false;
  }
  return test && tap && reporters === 1;
}
export function testStatus(counts, processResult, emptyFiles = 0) {
  if (processResult.status !== 'completed') return 'incomplete';
  if (!counts) return 'unknown';
  if (counts.failed || counts.cancelled || processResult.exitCode !== 0) return 'failed';
  // Passing file-level entries for files without tests are not test results.
  const total = counts.total - emptyFiles;
  if (!total) return 'no-tests';
  if (emptyFiles) return 'not-run';
  if (counts.passed) return 'passed';
  if (counts.skipped === counts.total) return 'skipped-only';
  return 'not-run';
}
// Node reports a selected file that registers no tests (or exits before
// registering any) as one passing top-level test named after that file, with
// no subtests. Count those entries so they are never treated as passing tests.
// A real top-level test named exactly like an existing file is conservatively
// counted too.
export function emptyTestFiles(output, work) {
  let count = 0, children = false;
  for (const line of output.split('\n')) {
    if (line.startsWith('# Subtest: ')) { children = false; continue; }
    if (/^\s+(?:not )?ok \d+/.test(line)) { children = true; continue; }
    const m = /^ok \d+ - (.*?)\r?$/.exec(line);
    if (!m || children || / # (?:SKIP|TODO)\b/i.test(m[1])) continue;
    const name = m[1].replace(/\\(.)/g, '$1');
    try { if (statSync(resolve(work, name)).isFile()) count++; } catch { /* not a file-level entry */ }
  }
  return count;
}
export function parseTests(command, output, processResult, work = process.cwd()) {
  let counts = null;
  if (isNodeTap(command) && output.startsWith('TAP version 13\n') && processResult.outputComplete) {
    const keys = { tests: 'total', pass: 'passed', fail: 'failed', cancelled: 'cancelled', skipped: 'skipped', todo: 'todo' };
    const found = {};
    for (const [key, field] of Object.entries(keys)) {
      const matches = [...output.matchAll(new RegExp('^# ' + key + ' (\\d+)\\r?$', 'gm'))];
      if (matches.length === 1) found[field] = Number(matches[0][1]);
    }
    if (Object.keys(found).length === 6 && Object.values(found).every(integer) &&
        found.total === found.passed + found.failed + found.cancelled + found.skipped + found.todo &&
        /^# duration_ms \d+(?:\.\d+)?\r?\n?$/.test(output.trimEnd().split('\n').at(-1))) counts = found;
  }
  const emptyFiles = counts ? Math.min(emptyTestFiles(output, work), counts.passed) : null;
  return { parser: counts ? 'node-tap-summary' : 'unknown', status: testStatus(counts, processResult, emptyFiles ?? 0), counts, emptyFiles, report: null };
}
// Reads a Jest/Vitest report inside root; null when absent, unsafe, excluded or too large.
function readReport(root, path) {
  try {
    const bytes = boundedRead(safeArtifact(root, path), MAX_REPORT);
    return { sha256: digest(bytes), bytes: bytes.length, text: bytes.toString('utf8') };
  } catch { return null; }
}
// For a recognized Jest/Vitest command, the root-relative report path it was told to write.
function reportTarget(command, rel) {
  const runner = jsonRunner(command);
  if (!runner) return null;
  const path = linkedPath(rel || '.', runner.outputFile);
  if (!path) throw new Error(`${runner.runner} --outputFile must be a relative path with / separators inside the project root`);
  relativePath(path);
  if (sensitivePath(path)) throw new Error('sensitive report path is excluded');
  return { runner: runner.runner, path };
}

async function execute(command, cwd, timeoutMs, maxOutputBytes) {
  const start = performance.now();
  const streams = { stdout: { hash: createHash('sha256'), bytes: 0 }, stderr: { hash: createHash('sha256'), bytes: 0 } };
  let capturedBytes = 0, outputComplete = true, status = 'completed', errorCode = null, exitCode = null, signal = null;
  const stdout = [];
  await new Promise(resolve => {
    let child, timeout, grace, force, finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout); clearTimeout(grace); clearTimeout(force);
      child?.stdout?.destroy(); child?.stderr?.destroy(); child?.unref();
      resolve();
    };
    const stop = reason => {
      if (status !== 'completed') return;
      status = reason; outputComplete = false;
      child.kill('SIGTERM');
      force = setTimeout(() => child.kill('SIGKILL'), 300);
      grace = setTimeout(finish, 1000);
    };
    // A ledger invoked inside node:test must start a fresh runner, not inherit its IPC context.
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    try { child = spawn(command.program, command.args, { cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (e) { status = 'launch-error'; errorCode = e.code ?? 'SPAWN_ERROR'; finish(); return; }
    timeout = setTimeout(() => stop('timed-out'), timeoutMs);
    for (const name of ['stdout', 'stderr']) child[name].on('data', data => {
      const take = Math.min(data.length, maxOutputBytes - capturedBytes);
      const portion = data.subarray(0, take);
      streams[name].hash.update(portion); streams[name].bytes += take; capturedBytes += take;
      if (name === 'stdout' && take) stdout.push(portion);
      if (take < data.length) stop('output-limit');
    });
    child.on('error', e => { status = 'launch-error'; errorCode = e.code ?? 'SPAWN_ERROR'; });
    child.on('exit', (code, sig) => { exitCode = code; signal = sig; });
    child.on('close', (code, sig) => { exitCode = status === 'launch-error' ? null : code; signal = sig; finish(); });
  });
  const output = {};
  for (const [name, stream] of Object.entries(streams)) output[name] = { bytes: stream.bytes, sha256: stream.hash.digest('hex') };
  return { process: { status, exitCode, signal, errorCode, timedOut: status === 'timed-out', durationMs: Math.round(performance.now() - start), outputComplete },
    output: { ...output, hashScope: outputComplete ? 'complete-streams' : 'captured-prefixes', rawStored: false },
    stdout: Buffer.concat(stdout).toString('utf8').replace(/\r\n/g, '\n') };
}
function gitState(root) {
  const run = args => spawnSync('git', ['--no-optional-locks', ...args], { cwd: root, encoding: 'utf8', timeout: 2000, maxBuffer: 1024 * 1024, windowsHide: true });
  // --show-toplevel may be C-quoted on Windows when temporary paths contain
  // Unicode. --show-prefix is empty only when cwd is the Git root and avoids
  // decoding a platform-specific absolute path from Git's output.
  const top = run(['rev-parse', '--show-prefix']);
  if (top.status !== 0) return { status: 'unavailable', commit: null, dirty: null };
  if (top.stdout.trim() !== '') return { status: 'unavailable', commit: null, dirty: null };
  const commit = run(['rev-parse', 'HEAD']);
  const dirty = run(['status', '--porcelain', '--untracked-files=normal']);
  return { status: dirty.status === 0 ? 'observed' : 'unavailable', commit: commit.status === 0 ? commit.stdout.trim() : null, dirty: dirty.status === 0 ? Boolean(dirty.stdout) : null };
}
export async function runLedger({ task, program, args = [], root = process.cwd(), cwd = '.', artifacts = [], agent = 'other', client = 'unknown', timeoutMs = 300000, maxOutputBytes = 1024 * 1024 }) {
  if (!text(task) || !task.trim()) throw new Error('run requires a nonempty task (at most 8192 characters)');
  if (!text(program) || !program.trim() || !Array.isArray(args) || args.length > 256 || args.some(a => !text(a))) throw new Error('invalid program or arguments');
  if (!oneOf(agent, ['claude', 'codex', 'other']) || !oneOf(client, ['cli', 'desktop', 'unknown'])) throw new Error('invalid agent or client label');
  if (!integer(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647 || !integer(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 16 * 1024 * 1024) throw new Error('invalid timeout or output limit');
  root = realpathSync(root);
  if (cwd !== '.') relativePath(cwd);
  const work = realpathSync(root + '/' + cwd);
  const rel = relative(root, work).split(sep).join('/');
  if (rel) relativePath(rel);
  if (!Array.isArray(artifacts) || artifacts.length > 128 || new Set(artifacts).size !== artifacts.length) throw new Error('artifacts must be unique (at most 128)');
  const before = artifacts.map(path => snapshot(root, path));
  const command = { program, args, shell: false };
  // A report that already exists must be safe, and only counts if the run rewrites it.
  const target = reportTarget(command, rel);
  let reportBefore = null;
  if (target) {
    let exists = true;
    try { lstatSync(resolve(root, target.path)); } catch (e) { if (e.code !== 'ENOENT') throw e; exists = false; }
    if (exists && !(reportBefore = readReport(root, target.path))) throw new Error('existing --outputFile report is unsafe, excluded or too large');
  }
  const git = gitState(root);
  const startedAt = new Date().toISOString();
  const execution = await execute(command, work, timeoutMs, maxOutputBytes);
  const endedAt = new Date().toISOString();
  const files = artifacts.map((path, i) => {
    let after = null;
    try { after = snapshot(root, path); } catch { /* unsafe/missing/oversized is visible, never silently omitted */ }
    return { path, beforeSha256: before[i].sha256, afterSha256: after?.sha256 ?? null,
      changedDuringRun: !after || after.sha256 !== before[i].sha256 || after.target !== before[i].target };
  });
  let tests;
  if (target) {
    const after = execution.process.status === 'completed' ? readReport(root, target.path) : null;
    const counts = after && after.sha256 !== reportBefore?.sha256 ? parseRunnerReport(after.text, execution.process.exitCode) : null;
    tests = counts
      ? { parser: `${target.runner}-json`, status: testStatus(counts, execution.process), counts, emptyFiles: 0, report: { path: target.path, sha256: after.sha256, bytes: after.bytes } }
      : { parser: 'unknown', status: testStatus(null, execution.process), counts: null, emptyFiles: null, report: null };
  } else tests = parseTests(command, execution.stdout, execution.process, work);
  const receipt = { schema: SCHEMA, id: randomUUID(), task, startedAt, endedAt, command,
    workingDirectory: rel || '.', process: execution.process, tests,
    output: execution.output, limits: { timeoutMs, maxOutputBytes }, artifacts: files, git,
    labels: { agent: { value: agent, source: 'user-supplied' }, client: { value: client, source: 'user-supplied' } } };
  receipt.selfHash = selfHashOf(receipt);
  if (Buffer.byteLength(JSON.stringify(receipt)) > MAX_RECEIPT) throw new Error('receipt exceeds 1 MiB');
  return receipt;
}

function validate(r) {
  if (!r || r.schema !== SCHEMA) throw new Error('unsupported or missing schema');
  if (!text(r.id, 36) || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(r.id) || !text(r.task) || !r.task.trim() || !date(r.startedAt) || !date(r.endedAt) || Date.parse(r.endedAt) < Date.parse(r.startedAt)) throw new Error('invalid identity or timestamps');
  const c = r.command, p = r.process, t = r.tests, o = r.output;
  if (!c || !text(c.program) || !c.program.trim() || !Array.isArray(c.args) || c.args.length > 256 || c.args.some(a => !text(a)) || c.shell !== false) throw new Error('invalid command schema');
  if (r.workingDirectory !== '.') relativePath(r.workingDirectory);
  if (!p || !oneOf(p.status, ['completed', 'launch-error', 'timed-out', 'output-limit']) || !(p.exitCode === null || integer(p.exitCode)) || !(p.signal === null || text(p.signal, 64)) || !(p.errorCode === null || text(p.errorCode, 64)) || !integer(p.durationMs) || typeof p.outputComplete !== 'boolean' || p.timedOut !== (p.status === 'timed-out') ||
      (p.status === 'completed' && (!p.outputComplete || p.errorCode !== null || (p.exitCode === null && p.signal === null))) ||
      (p.exitCode !== null && p.signal !== null) ||
      (p.status === 'launch-error' && (!p.errorCode || p.exitCode !== null)) ||
      (['timed-out', 'output-limit'].includes(p.status) && p.outputComplete)) throw new Error('invalid or inconsistent process result');
  if (!o || o.rawStored !== false || o.hashScope !== (p.outputComplete ? 'complete-streams' : 'captured-prefixes') || ['stdout', 'stderr'].some(k => !o[k] || !integer(o[k].bytes) || !hash(o[k].sha256))) throw new Error('invalid output evidence');
  if (!r.limits || !integer(r.limits.timeoutMs) || r.limits.timeoutMs < 1 || r.limits.timeoutMs > 2147483647 || !integer(r.limits.maxOutputBytes) || r.limits.maxOutputBytes < 1 || r.limits.maxOutputBytes > 16 * 1024 * 1024 || o.stdout.bytes + o.stderr.bytes > r.limits.maxOutputBytes) throw new Error('invalid limits');
  if (!t || !oneOf(t.parser, ['unknown', 'node-tap-summary', 'jest-json', 'vitest-json'])) throw new Error('invalid test evidence');
  if (t.parser.endsWith('-json')) {
    const runner = jsonRunner(c), rep = t.report;
    if (!runner || `${runner.runner}-json` !== t.parser || !rep || typeof rep !== 'object' || !hash(rep.sha256) || !integer(rep.bytes) || rep.bytes > MAX_REPORT ||
        linkedPath(r.workingDirectory, runner.outputFile) !== rep.path || t.emptyFiles !== 0) throw new Error('inconsistent runner report evidence');
    relativePath(rep.path);
  } else if (t.report !== undefined && t.report !== null) throw new Error('unexpected runner report evidence');
  if (t.counts !== null) {
    const n = t.counts;
    if (t.parser === 'unknown' || (t.parser === 'node-tap-summary' && !isNodeTap(c)) || p.status !== 'completed' || !p.outputComplete || ['total', 'passed', 'failed', 'cancelled', 'skipped', 'todo'].some(k => !integer(n[k])) || n.total !== n.passed + n.failed + n.cancelled + n.skipped + n.todo) throw new Error('inconsistent test counts');
  } else if (t.parser !== 'unknown') throw new Error('missing test counts');
  // emptyFiles is absent only in records created before this check existed.
  if (t.emptyFiles !== undefined && (t.counts === null ? t.emptyFiles !== null : !integer(t.emptyFiles) || t.emptyFiles > t.counts.passed)) throw new Error('inconsistent empty test file count');
  if (t.status !== testStatus(t.counts, p, t.emptyFiles ?? 0)) throw new Error('inconsistent test status');
  if (!Array.isArray(r.artifacts) || r.artifacts.length > 128 || new Set(r.artifacts.map(a => a?.path)).size !== r.artifacts.length) throw new Error('invalid artifacts');
  for (const a of r.artifacts) {
    relativePath(a?.path);
    if (!hash(a.beforeSha256) || !(a.afterSha256 === null || hash(a.afterSha256)) || typeof a.changedDuringRun !== 'boolean' || (!a.changedDuringRun && a.beforeSha256 !== a.afterSha256)) throw new Error('inconsistent artifact snapshot');
  }
  if (!r.git || !oneOf(r.git.status, ['observed', 'unavailable']) || !(r.git.commit === null || /^[0-9a-f]{40,64}$/.test(r.git.commit)) || !(r.git.dirty === null || typeof r.git.dirty === 'boolean') || (r.git.status === 'unavailable' && (r.git.commit !== null || r.git.dirty !== null)) || (r.git.status === 'observed' && r.git.dirty === null)) throw new Error('invalid Git evidence');
  for (const [k, values] of [['agent', ['claude', 'codex', 'other']], ['client', ['cli', 'desktop', 'unknown']]]) {
    if (!r.labels?.[k] || !oneOf(r.labels[k].value, values) || r.labels[k].source !== 'user-supplied') throw new Error('invalid labels: this schema only supports user-supplied provenance');
  }
  if (!hash(r.selfHash)) throw new Error('invalid selfHash');
  if (r.signature !== undefined && (!r.signature || r.signature.alg !== 'ed25519' || typeof r.signature.value !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(r.signature.value))) throw new Error('invalid signature encoding');
}
export function verifyLedger(receipt, { root = process.cwd(), publicKeyPem } = {}) {
  const signatureRequested = publicKeyPem !== undefined;
  const result = { valid: false, integrity: 'invalid', signature: signatureRequested ? 'invalid' : 'not-checked', freshness: 'unknown', currentTestEvidence: false, files: [], problems: [] };
  try {
    validate(receipt);
    if (selfHashOf(receipt) !== receipt.selfHash) throw new Error('selfHash does not match receipt contents');
    result.integrity = 'consistent';
    if (signatureRequested) {
      const issue = signatureProblem(receipt, publicKeyPem);
      if (issue) { result.problems.push(issue); } else result.signature = 'verified-with-supplied-key';
    }
    result.files = receipt.artifacts.map(a => {
      let state;
      try { const now = snapshot(root, a.path); state = a.changedDuringRun ? 'changed-during-run' : now.sha256 !== a.afterSha256 ? 'stale' : 'current'; }
      catch { state = 'unavailable-or-unsafe'; }
      return { path: a.path, state };
    });
    result.freshness = !result.files.length ? 'untracked' : result.files.every(f => f.state === 'current') ? 'current' : 'stale';
    result.valid = !result.problems.length;
    result.currentTestEvidence = result.valid && result.freshness === 'current' && receipt.tests.status === 'passed' && receipt.tests.emptyFiles === 0 && receipt.process.status === 'completed' && receipt.process.exitCode === 0 && receipt.process.signal === null;
  } catch (e) { result.problems.push(e.message); }
  return result;
}
