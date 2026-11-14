// Copyright (c) 2026 Ferhat Kosger. MIT License.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boundedRead } from './files.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const GRACE_MS = 300;
const CLEANUP_MS = 2000;
const STARTUP_MS = 30000;
const MAX_TIMER_MS = 2147483647;
const names = ['stdout', 'stderr'];
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (x, keys) => object(x) && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x, k));
const error = x => x === null || typeof x === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(x);

// Node clamps overflowing delays to 1 ms. Keep long watchdogs monotonic and
// schedule bounded chunks instead. https://nodejs.org/api/timers.html#settimeoutcallback-delay-args
function deadlineAfter(ms, callback) {
  const state = { timer: null, cancelled: false }, deadline = performance.now() + ms;
  const tick = () => {
    if (state.cancelled) return;
    const remaining = deadline - performance.now();
    if (remaining <= 0) callback();
    else state.timer = setTimeout(tick, Math.min(MAX_TIMER_MS, Math.ceil(remaining)));
  };
  tick(); return state;
}
function cancelDeadline(state) {
  if (state) { state.cancelled = true; clearTimeout(state.timer); }
}

export function cleanupAllowsEvidence(control) {
  return control?.cleanup?.status === 'confirmed';
}

export function validateProcessControl(control, result) {
  if (!exact(control, ['scope', 'strategy', 'cleanup']) || !['tree', 'direct'].includes(control.scope) ||
      !['windows-job', 'posix-process-group', 'direct-child', 'unsupported'].includes(control.strategy) ||
      (control.scope === 'direct') !== (control.strategy === 'direct-child') ||
      !exact(control.cleanup, ['status', 'errorCode']) || !['confirmed', 'not-started', 'unconfirmed', 'failed'].includes(control.cleanup.status) ||
      !error(control.cleanup.errorCode) ||
      (['confirmed', 'not-started'].includes(control.cleanup.status) && control.cleanup.errorCode !== null) ||
      (['unconfirmed', 'failed'].includes(control.cleanup.status) && control.cleanup.errorCode === null) ||
      (control.cleanup.status === 'not-started' && (['completed', 'control-error'].includes(result.status) || result.exitCode !== null || result.signal !== null)) ||
      (control.strategy === 'windows-job' && (result.signal !== null || result.exitCode !== null && result.exitCode > 0xffffffff)) ||
      (control.strategy === 'unsupported' && (result.status !== 'launch-error' || control.cleanup.status !== 'not-started'))) throw new Error('invalid process control evidence');
}

// kill(-pid, signal) targets the detached process group, including descendants
// after its original leader exits. https://nodejs.org/api/child_process.html#optionsdetached
// https://man7.org/linux/man-pages/man2/kill.2.html
function signalGroup(pid, signal) {
  try { process.kill(-pid, signal); return null; }
  catch (e) { return e.code === 'ESRCH' ? null : e.code === 'EPERM' ? 'EPERM' : 'GROUP_SIGNAL_ERROR'; }
}

function groupState(pid) {
  if (process.platform === 'linux') {
    // Linux can retain orphaned zombies under a non-reaping PID 1. They cannot
    // execute or write output; kill(group, 0) alone would count them as live.
    // https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html
    let uncertain = false;
    try {
      for (const entry of readdirSync('/proc')) {
        if (!/^\d+$/.test(entry)) continue;
        try {
          const raw = readFileSync(`/proc/${entry}/stat`, 'utf8');
          const fields = raw.slice(raw.lastIndexOf(')') + 2).split(' ');
          if (Number(fields[2]) === pid && !['Z', 'X', 'x'].includes(fields[0])) return 'live';
        } catch (e) { if (e.code !== 'ENOENT' && e.code !== 'ESRCH') uncertain = true; }
      }
      return uncertain ? 'unknown' : 'gone';
    } catch { return 'unknown'; }
  }
  try { process.kill(-pid, 0); return 'live'; }
  catch (e) { return e.code === 'ESRCH' ? 'gone' : 'unknown'; }
}

async function cleanGroup(pid) {
  if (groupState(pid) === 'gone') return { status: 'confirmed', errorCode: null };
  let problem = signalGroup(pid, 'SIGTERM');
  const grace = performance.now() + GRACE_MS;
  while (performance.now() < grace) {
    if (groupState(pid) === 'gone') return { status: 'confirmed', errorCode: null };
    await delay(20);
  }
  problem = signalGroup(pid, 'SIGKILL') ?? problem;
  const end = performance.now() + CLEANUP_MS;
  while (performance.now() < end) {
    if (groupState(pid) === 'gone') return { status: 'confirmed', errorCode: null };
    await delay(20);
  }
  return { status: problem ? 'failed' : 'unconfirmed', errorCode: problem ?? 'GROUP_CLEANUP_UNCONFIRMED' };
}

function executable(program, cwd, env) {
  const hasPath = /[\\/]/.test(program);
  const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH');
  const roots = hasPath ? [''] : (env[pathKey] ?? '').split(delimiter).filter(Boolean).map(dir => /^".*"$/.test(dir) ? dir.slice(1, -1) : dir);
  const extension = extname(program);
  if (/^\.(?:cmd|bat)$/i.test(extension)) throw Object.assign(new Error(), { code: 'UNSUPPORTED_EXECUTABLE' });
  for (const dir of roots) {
    for (const suffix of /^\.(?:exe|com)$/i.test(extension) ? [''] : ['.exe', '.com']) {
      const candidate = hasPath ? resolve(cwd, program + suffix) : resolve(cwd, dir, program + suffix);
      try { if (statSync(candidate).isFile()) return candidate; } catch { /* try next PATH entry */ }
    }
  }
  // An absolute path without a slash is not possible on Windows, but retain an
  // explicit guard so no relative path reaches CreateProcessW.
  if (isAbsolute(program)) throw Object.assign(new Error(), { code: 'ENOENT' });
  throw Object.assign(new Error(), { code: 'ENOENT' });
}

/** Runs literal argv with bounded capture and a separately measured lifecycle. */
export async function execute(command, cwd, timeoutMs, maxOutputBytes, scope = 'tree') {
  const start = performance.now();
  const strategy = scope === 'direct' ? 'direct-child' : process.platform === 'win32' ? 'windows-job' : process.platform === 'linux' ? 'posix-process-group' : 'unsupported';
  const processControl = { scope, strategy, cleanup: { status: 'not-started', errorCode: null } };
  const streams = Object.fromEntries(names.map(n => [n, { hash: createHash('sha256'), bytes: 0 }]));
  const stdout = [];
  let captured = 0, outputComplete = true, status = 'completed', errorCode = null, exitCode = null, signal = null;
  let requestStop = () => {};
  const interrupt = () => requestStop('interrupted');
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const capture = (name, data) => {
    const take = Math.min(data.length, maxOutputBytes - captured), portion = data.subarray(0, take);
    streams[name].hash.update(portion); streams[name].bytes += take; captured += take;
    if (name === 'stdout' && take) stdout.push(portion);
    if (take < data.length) requestStop('output-limit');
  };
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  try {
    if (strategy === 'unsupported') {
      status = 'launch-error'; errorCode = 'UNSUPPORTED_PROCESS_SCOPE'; outputComplete = false;
    } else if (strategy === 'windows-job') {
      let directory;
      try {
        const program = executable(command.program, cwd, env);
        directory = mkdtempSync(join(tmpdir(), 'agent-test-ledger-job-'));
        const statePath = join(directory, 'state.json'), stopPath = join(directory, 'stop');
        const here = dirname(fileURLToPath(import.meta.url));
        const script = readFileSync(join(here, 'windows-job.ps1'), 'utf8');
        env.ATL_JOB_SOURCE = join(here, 'windows-job.cs');
        const bootstrap = join(process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
        await new Promise(done => {
          let child, poll, startup, commandTimer, stopTimer, finishTimer, finished = false, final = null, stopReason = null;
          const finish = () => {
            if (finished) return; finished = true;
            clearInterval(poll); clearTimeout(startup); cancelDeadline(commandTimer); clearTimeout(stopTimer); clearTimeout(finishTimer);
            child?.stdout?.destroy(); child?.stderr?.destroy(); child?.unref();
            if (final) {
              status = stopReason ?? final.status; exitCode = final.exitCode; signal = null; errorCode = final.errorCode;
              processControl.cleanup = { status: final.cleanup, errorCode: final.cleanupError };
              if (status !== 'completed') outputComplete = false;
            } else {
              status = stopReason ?? (child?.pid ? 'control-error' : 'launch-error'); errorCode ??= 'JOB_CONTROL_ERROR'; outputComplete = false;
              processControl.cleanup = child?.pid ? { status: 'unconfirmed', errorCode: 'JOB_CLEANUP_UNCONFIRMED' } : { status: 'not-started', errorCode: null };
            }
            done();
          };
          requestStop = reason => {
            if (stopReason) return;
            stopReason = reason; outputComplete = false;
            try { writeFileSync(stopPath, reason, { flag: 'wx', mode: 0o600 }); } catch { /* a prior request is sufficient */ }
            stopTimer = setTimeout(() => { child.kill('SIGKILL'); finish(); }, CLEANUP_MS * 2 + 1000);
          };
          const state = () => {
            try {
              const s = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(boundedRead(statePath, 4096)));
              if (['started', 'root-exited'].includes(s.phase) && Number.isInteger(s.rootPid) && s.rootPid > 0) {
                clearTimeout(startup);
                if (s.phase === 'root-exited' && !stopTimer) stopTimer = setTimeout(() => { errorCode = 'JOB_CONTROL_TIMEOUT'; child.kill('SIGKILL'); finish(); }, CLEANUP_MS * 2 + 1000);
                commandTimer ??= deadlineAfter(timeoutMs + CLEANUP_MS + 1000, () => { errorCode = 'JOB_CONTROL_TIMEOUT'; requestStop('timed-out'); });
              }
              else if (exact(s, ['phase', 'started', 'rootPid', 'status', 'exitCode', 'errorCode', 'cleanup', 'cleanupError']) && s.phase === 'completed' && typeof s.started === 'boolean' &&
                  (s.rootPid === null || Number.isInteger(s.rootPid) && s.rootPid > 0) && (!s.started || s.rootPid !== null) &&
                  ['completed', 'launch-error', 'timed-out', 'output-limit', 'interrupted', 'control-error'].includes(s.status) &&
                  (s.exitCode === null || Number.isInteger(s.exitCode) && s.exitCode >= 0 && s.exitCode <= 0xffffffff) && error(s.errorCode) &&
                  ['confirmed', 'not-started', 'unconfirmed', 'failed'].includes(s.cleanup) && error(s.cleanupError)) {
                final = s; clearTimeout(startup);
                finishTimer ??= setTimeout(() => { outputComplete = false; child.kill('SIGKILL'); finish(); }, CLEANUP_MS);
              }
            } catch { /* atomic state may not exist yet */ }
          };
          try { child = spawn(bootstrap, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { cwd, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); }
          catch (e) { status = 'launch-error'; errorCode = e.code ?? 'JOB_BOOTSTRAP_ERROR'; finish(); return; }
          for (const name of names) child[name].on('data', data => capture(name, data));
          child.stdin.on('error', () => {});
          child.stdin.end(JSON.stringify({ program, args: command.args, cwd, statePath, stopPath, parentPid: process.pid, timeoutMs }));
          child.on('error', e => { errorCode = e.code === 'ENOENT' ? 'ENOENT' : 'JOB_BOOTSTRAP_ERROR'; });
          child.on('close', () => { state(); finish(); });
          poll = setInterval(state, 20);
          startup = setTimeout(() => { errorCode = 'JOB_STARTUP_TIMEOUT'; child.kill('SIGKILL'); finish(); }, STARTUP_MS);
        });
      } catch (e) {
        status = 'launch-error'; errorCode = ['ENOENT', 'UNSUPPORTED_EXECUTABLE'].includes(e.code) ? e.code : 'JOB_SETUP_ERROR'; outputComplete = false;
      } finally {
        if (directory) { try { rmSync(directory, { recursive: true, force: true, maxRetries: 3 }); } catch { /* bounded runtime files may be retained on external interference */ } }
      }
    } else {
      await new Promise(done => {
        let child, timer, finishing = false, closed = false, rootExited = false;
        const complete = async () => {
          if (finishing) return; finishing = true; clearTimeout(timer);
          if (child.pid && strategy === 'posix-process-group') processControl.cleanup = await cleanGroup(child.pid);
          else if (child.pid) {
            if (!rootExited) {
              child.kill('SIGTERM'); await delay(GRACE_MS);
              if (!rootExited) child.kill('SIGKILL');
              const end = performance.now() + CLEANUP_MS;
              while (!rootExited && performance.now() < end) await delay(20);
            }
            processControl.cleanup = rootExited ? { status: 'confirmed', errorCode: null } : { status: 'unconfirmed', errorCode: 'CHILD_CLEANUP_UNCONFIRMED' };
          }
          const end = performance.now() + CLEANUP_MS;
          while (!closed && performance.now() < end) await delay(20);
          if (!closed) { outputComplete = false; child.stdout?.destroy(); child.stderr?.destroy(); child.unref(); }
          done();
        };
        requestStop = reason => {
          if (status === 'completed') { status = reason; outputComplete = false; }
          void complete();
        };
        try { child = spawn(command.program, command.args, { cwd, env, shell: false, detached: strategy === 'posix-process-group', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
        catch (e) { status = 'launch-error'; errorCode = e.code ?? 'SPAWN_ERROR'; outputComplete = false; done(); return; }
        timer = setTimeout(() => requestStop('timed-out'), timeoutMs);
        for (const name of names) child[name].on('data', data => capture(name, data));
        child.on('error', e => { status = 'launch-error'; errorCode = e.code ?? 'SPAWN_ERROR'; outputComplete = false; });
        child.on('exit', (code, sig) => { rootExited = true; exitCode = code; signal = sig; void complete(); });
        child.on('close', (code, sig) => {
          closed = true;
          if (status !== 'launch-error') { rootExited = true; exitCode = code; signal = sig; }
          void complete();
        });
      });
    }
  } finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); }
  const output = Object.fromEntries(names.map(name => [name, { bytes: streams[name].bytes, sha256: streams[name].hash.digest('hex') }]));
  return { process: { status, exitCode, signal, errorCode, timedOut: status === 'timed-out', durationMs: Math.round(performance.now() - start), outputComplete }, processControl,
    output: { ...output, hashScope: outputComplete ? 'complete-streams' : 'captured-prefixes', rawStored: false },
    stdout: Buffer.concat(stdout).toString('utf8').replace(/\r\n/g, '\n') };
}
