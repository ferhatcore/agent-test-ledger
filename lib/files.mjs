// Copyright (c) 2026 Ferhat Kosger. MIT License.
import { constants, openSync, closeSync, readSync, fstatSync, realpathSync, lstatSync, statSync, writeFileSync } from 'node:fs';
import { resolve, relative, isAbsolute, win32, sep, dirname } from 'node:path';
import { createHash } from 'node:crypto';

export const digest = data => createHash('sha256').update(data).digest('hex');
export const MAX_RECEIPT = 1024 * 1024;
export const MAX_ARTIFACT = 64 * 1024 * 1024;
const sensitiveName = /^(?:\.env(?:\..*)?|\.envrc|\.npmrc|\.netrc|\.pypirc|\.git-credentials|\.credentials|\.docker|\.kube|\.gnupg|\.git|\.ssh|\.aws|\.azure|\.config|\.claude|\.codex|node_modules|credentials(?:\..*)?|secrets?(?:\..*)?|id_(?:rsa|ed25519|ecdsa)|.*\.(?:pem|key|p12|pfx|keystore))$/i;
export function relativePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes(':') ||
      /[\x00-\x1f\x7f]/.test(value) || isAbsolute(value) || win32.isAbsolute(value) ||
      value.split('/').some(p => !p || p === '.' || p === '..')) throw new Error('path must be a normalized relative path inside root');
  return value;
}
function inside(root, target) {
  const r = relative(root, target);
  if (!r || isAbsolute(r) || r === '..' || r.startsWith('..' + sep)) throw new Error('path escapes root');
}
export const sensitivePath = path => path.split('/').some(p => sensitiveName.test(p));
// A new file cannot be realpathed yet. Validate its nearest existing parent
// without creating directories; a dangling link is not a missing directory.
export function safeReportDestination(root, path) {
  relativePath(path);
  if (sensitivePath(path)) throw new Error('sensitive report path is excluded');
  const base = realpathSync(root);
  let parent = dirname(resolve(base, path));
  for (;;) {
    try { lstatSync(parent); }
    catch (e) {
      if (e.code !== 'ENOENT') throw e;
      const next = dirname(parent);
      if (next === parent) throw new Error('report parent is unavailable');
      parent = next; continue;
    }
    const actual = realpathSync(parent);
    if (actual !== base) inside(base, actual);
    if (sensitivePath(relative(base, actual).split(sep).join('/'))) throw new Error('sensitive report parent is excluded');
    if (!statSync(actual).isDirectory()) throw new Error('report parent must be a directory');
    return;
  }
}
export function safeArtifact(root, path) {
  relativePath(path);
  if (sensitivePath(path)) throw new Error('sensitive artifact path is excluded');
  const base = realpathSync(root);
  const lexical = resolve(base, path);
  inside(base, lexical);
  const actual = realpathSync(lexical);
  inside(base, actual);
  // Reject sensitive targets even when a harmless-looking symlink points at them.
  const actualRelative = relative(base, actual).split(sep).join('/');
  if (actualRelative !== path) {
    if (actualRelative.split('/').some(p => sensitiveName.test(p))) throw new Error('sensitive artifact target is excluded');
  }
  return actual;
}
export function boundedRead(path, limit) {
  // O_NONBLOCK prevents a hostile FIFO from hanging before fstat can reject it.
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  try {
    const st = fstatSync(fd);
    if (!st.isFile() || st.size > limit) throw new Error(`input must be a regular file within ${limit} byte limit`);
    // Read a bounded buffer even if another process grows the file after fstat.
    const buffer = Buffer.alloc(limit + 1);
    return readBounded(fd, buffer, limit);
  } finally { closeSync(fd); }
}
function readBounded(fd, buffer, limit) {
  let n = 0, got;
  do { got = readSync(fd, buffer, n, buffer.length - n, null); n += got; } while (got && n < buffer.length);
  if (n > limit) throw new Error('input grew beyond size limit');
  return buffer.subarray(0, n);
}
export function snapshot(root, path) {
  const actual = safeArtifact(root, path);
  const bytes = boundedRead(actual, MAX_ARTIFACT);
  if (/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/.test(bytes.toString('utf8'))) throw new Error('private key content is excluded');
  return { sha256: digest(bytes), target: actual };
}
export function absent(path) {
  try { lstatSync(path); } catch (e) { if (e.code === 'ENOENT') return; throw e; }
  throw new Error('output already exists; refusing to overwrite');
}
export function exclusiveWrite(path, data) { writeFileSync(path, data, { flag: 'wx', mode: 0o600 }); }
export function readReceipt(path) {
  const text = boundedRead(path, MAX_RECEIPT).toString('utf8');
  // Limit nesting before JSON.parse/canonicalize to avoid adversarial recursion.
  let depth = 0, quoted = false, escaped = false;
  for (const c of text) {
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = true;
    else if (c === '[' || c === '{') { if (++depth > 24) throw new Error('receipt nesting exceeds limit'); }
    else if (c === ']' || c === '}') depth--;
  }
  return JSON.parse(text);
}
