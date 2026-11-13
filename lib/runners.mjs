// Copyright (c) 2026 Ferhat Kosger. MIT License.
// Jest and Vitest JSON report recognition. Counts come only from a report file
// that the recognized command was told to write and that was (re)written
// during the run. Anything else stays unknown.
import { basename, posix, win32 } from 'node:path';

export const MAX_REPORT = 16 * 1024 * 1024;
const integer = x => Number.isSafeInteger(x) && x >= 0;
const nodeProgram = program => /^node(?:\.exe)?$/i.test(basename(program));
const script = (value, pattern) => typeof value === 'string' && pattern.test(value.replace(/\\/g, '/'));
const JEST = /(?:^|\/)node_modules\/jest\/bin\/jest\.js$/;
const VITEST = /(?:^|\/)node_modules\/vitest\/vitest\.mjs$/;

function values(args, name) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name) { out.push(args[i + 1] ?? ''); i++; }
    else if (args[i].startsWith(name + '=')) out.push(args[i].slice(name.length + 1));
  }
  return out;
}

/**
 * Recognizes `node [--experimental-vm-modules] node_modules/jest/bin/jest.js --json --outputFile=FILE ...`
 * and `node node_modules/vitest/vitest.mjs run --reporter=json --outputFile=FILE ...`.
 * Returns { runner, outputFile } or null. Options that change or redirect results,
 * watch modes and informational commands are rejected rather than guessed.
 */
export function jsonRunner(command) {
  const args = command?.args;
  if (!Array.isArray(args) || typeof command.program !== 'string' || !nodeProgram(command.program)) return null;
  let i = 0;
  while (i < args.length && /^--(?:experimental-vm-modules|no-warnings)$/.test(args[i])) i++;
  const entry = args[i], rest = args.slice(i + 1);
  if (script(entry, JEST)) {
    if (rest.filter(a => a === '--json').length !== 1) return null;
    if (rest.some(a => /^(?:--watch|--watchAll|--listTests|--showConfig|--help|-h|--version|-v|--testResultsProcessor|--init|--clearCache)(?:=|$)/.test(a) ||a.startsWith('--outputFile.'))) return null;
    const files = values(rest, '--outputFile');
    return files.length === 1 && files[0] ? { runner: 'jest', outputFile: files[0] } : null;
  }
  if (script(entry, VITEST)) {
    if (rest[0] !== 'run') return null;
    const opts = rest.slice(1);
    const reporters = values(opts, '--reporter');
    if (reporters.length !== 1 || reporters[0] !== 'json' || opts.some(a => /^--reporters?\./.test(a))) return null;
    if (opts.some(a => /^(?:--watch|-w|--ui|--open|--help|-h|--version|-v|--standalone|--mergeReports)(?:=|$)/.test(a))) return null;
    const files = [...values(opts, '--outputFile'), ...values(opts, '--outputFile.json')];
    if (opts.some(a => /^--outputFile\.(?!json(?:=|$))/.test(a))) return null;
    return files.length === 1 && files[0] ? { runner: 'vitest', outputFile: files[0] } : null;
  }
  return null;
}

/** Joins a relative --outputFile value to the working directory; null if absolute, escaping or ambiguous. */
export function linkedPath(workingDirectory, value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes(':') || /[\x00-\x1f\x7f]/.test(value) ||
      posix.isAbsolute(value) || win32.isAbsolute(value)) return null;
  const joined = posix.normalize((workingDirectory === '.' ? '' : workingDirectory + '/') + value);
  if (joined === '.' || joined === '..' || joined.startsWith('../') || joined.endsWith('/')) return null;
  return joined;
}

/** Parses a Jest/Vitest JSON report into ledger counts, or null if malformed or contradictory. */
export function parseRunnerReport(text, exitCode) {
  let j;
  try { j = JSON.parse(text); } catch { return null; }
  if (!j || typeof j !== 'object' || Array.isArray(j) || typeof j.success !== 'boolean') return null;
  const total = j.numTotalTests, passed = j.numPassedTests, failed = j.numFailedTests, skipped = j.numPendingTests, todo = j.numTodoTests;
  const failedSuites = j.numFailedTestSuites ?? 0, runtimeErrors = j.numRuntimeErrorTestSuites ?? 0;
  if (![total, passed, failed, skipped, todo, failedSuites, runtimeErrors].every(integer)) return null;
  if (total !== passed + failed + skipped + todo) return null;
  // A clean exit must agree with the report; otherwise the evidence is contradictory.
  if (exitCode === 0 && (!j.success || failed || failedSuites || runtimeErrors)) return null;
  return { total, passed, failed, cancelled: 0, skipped, todo };
}
