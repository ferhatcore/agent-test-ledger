// Copyright (c) 2026 Ferhat Kosger. MIT License.
import { boundedRead, digest, safeArtifact } from './files.mjs';

export const MAX_CLIENT_CONTEXT = 64 * 1024;
// Common events documented by both clients; event-specific payloads are not stored.
// https://learn.chatgpt.com/docs/hooks#common-input-fields
// https://code.claude.com/docs/en/hooks#common-input-fields
export const HOOK_EVENTS = Object.freeze(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop']);
// SessionStart's source describes how the session started, not input provenance.
// https://learn.chatgpt.com/docs/hooks#sessionstart
const SESSION_SOURCES = ['startup', 'resume', 'clear', 'compact', 'fork'];
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const keys = (x, expected) => object(x) && Object.keys(x).length === expected.length && expected.every(k => Object.hasOwn(x, k));
const hash = x => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x);
const boundedText = (x, max) => typeof x === 'string' && x.trim().length > 0 && x.length <= max && !/[\x00-\x1f\x7f\ud800-\udfff]/u.test(x);

function hookInput(bytes) {
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  let depth = 0, quoted = false, escaped = false;
  for (const c of text) {
    if (quoted) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === '"') quoted = false; }
    else if (c === '"') quoted = true;
    else if (c === '[' || c === '{') { if (++depth > 16) throw new Error('client context nesting exceeds limit'); }
    else if (c === ']' || c === '}') depth--;
  }
  const input = JSON.parse(text);
  if (!object(input) || !boundedText(input.session_id, 1024) || !boundedText(input.cwd, 8192) || !HOOK_EVENTS.includes(input.hook_event_name) ||
      ['authenticated', 'agent', 'client', 'observations', '__proto__', 'constructor', 'prototype'].some(k => Object.hasOwn(input, k)) ||
      Object.hasOwn(input, 'source') && (input.hook_event_name !== 'SessionStart' || !SESSION_SOURCES.includes(input.source))) throw new Error('unsupported client context shape');
  return { source: 'hook-input', sha256: digest(bytes), bytes: bytes.length, event: input.hook_event_name, sessionSha256: digest(input.session_id) };
}

/** Records visible, forgeable signals. Neither input authenticates a client. */
export function observeClientContext(root, path) {
  // https://code.claude.com/docs/en/env-vars documents this exact marker value.
  const environment = process.env.CLAUDECODE === '1' ? [{ source: 'environment', name: 'CLAUDECODE', value: '1' }] : [];
  let hook = null;
  if (path !== undefined) {
    try { hook = hookInput(boundedRead(safeArtifact(root, path), MAX_CLIENT_CONTEXT)); }
    catch { throw new Error('client context must be safe project-relative UTF-8 hook JSON within 65536 bytes with a supported event, session_id and cwd'); }
  }
  return { authenticated: false, environment, hook };
}

export function validateClientObservations(value) {
  if (!keys(value, ['authenticated', 'environment', 'hook']) || value.authenticated !== false || !Array.isArray(value.environment) || value.environment.length > 1 ||
      value.environment.some(e => !keys(e, ['source', 'name', 'value']) || e.source !== 'environment' || e.name !== 'CLAUDECODE' || e.value !== '1')) throw new Error('invalid client observations');
  const h = value.hook;
  if (h !== null && (!keys(h, ['source', 'sha256', 'bytes', 'event', 'sessionSha256']) || h.source !== 'hook-input' || !hash(h.sha256) ||
      !Number.isSafeInteger(h.bytes) || h.bytes < 1 || h.bytes > MAX_CLIENT_CONTEXT || !HOOK_EVENTS.includes(h.event) || !hash(h.sessionSha256))) throw new Error('invalid hook observation');
}
