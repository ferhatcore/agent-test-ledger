#!/usr/bin/env node
// Copyright (c) 2026 Ferhat Kosger. MIT License.
import { realpathSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runLedger, verifyLedger } from './lib/ledger.mjs';
import { cleanupAllowsEvidence } from './lib/execution.mjs';
import { renderReport } from './lib/report.mjs';
import { readReceipt, boundedRead, absent, exclusiveWrite } from './lib/files.mjs';
import { signReceipt, generateKeys, loadPrivateKey } from './receipt.mjs';

export const HELP = `Agent Test Ledger 0.10.0 — Node.js >=22, no dependencies

Usage:
  node ledger.mjs run --task TEXT [options] -- PROGRAM [ARG ...]
  node ledger.mjs verify RECORD [--root DIR] [--pubkey FILE]
  node ledger.mjs report RECORD --out FILE [--root DIR] [--pubkey FILE]
  node ledger.mjs keygen --out-dir DIR

Run options:
  --root DIR              Project root (default: current directory)
  --cwd PATH              Working directory relative to root (default: .)
  --artifact PATH         Existing related file relative to root; repeatable
  --agent LABEL           claude | codex | other (default: other)
  --client LABEL          cli | desktop | unknown (default: unknown)
  --client-context PATH   Optional project-relative hook JSON (at most 64 KiB)
  --process-scope SCOPE   tree (default) | direct (direct child only)
  --timeout MS            Command timeout after launch (default: 300000)
  --max-output BYTES      Combined captured output limit (default: 1048576)
  --out FILE              New receipt file (default: .test-ledger/<UUID>.json)
  --sign-key FILE         Optional Ed25519 private key

Node counts require: node --test --test-reporter=tap [test-file ...]
Jest counts: node node_modules/jest/bin/jest.js --json --outputFile=FILE
pytest counts: python -m pytest --junit-xml=FILE
Vitest counts: node node_modules/vitest/vitest.mjs run --reporter=json --outputFile=FILE
Runner report paths are relative to --cwd, inside --root, and must be rewritten.
Other runners and npm/shell wrappers have unknown test counts.
Paths for --out, keys and RECORD resolve against the invoking directory.
No automatic shell. To use a shell, explicitly name its program (e.g. sh -c).
Tree scope uses Linux process groups or Windows Job Objects; setup fails closed.
Direct scope controls only the immediate child. Commands run with your permissions.
This tool is not a sandbox; processes using other sessions or brokers can escape.
Labels are user supplied; they do not authenticate the AI client.
Client observations are forgeable environment/hook signals, never authenticated.
Raw output is never stored. Arguments may contain secrets: do not put them there.

Exit codes:
  run: 0 = passed tests + exit 0 + confirmed cleanup + unchanged listed snapshots; 1 = other outcome
  verify: 0 = consistent record, requested signature valid, files not stale;
          1 = invalid/stale. Failed or unknown tests can still have valid records.
  report: same as verify, but writes an HTML report even for invalid records
  keygen: 0 = created; all commands: 2 = usage/input/output error
Legacy: node receipt.mjs make|verify|keygen retains upstream behavior.
`;

function parse(command, args) {
  const flags = { run: ['task', 'root', 'cwd', 'artifact', 'agent', 'client', 'client-context', 'process-scope', 'timeout', 'max-output', 'out', 'sign-key'], verify: ['root', 'pubkey'], report: ['root', 'pubkey', 'out'], keygen: ['out-dir'] }[command];
  if (!flags) throw new Error('unknown command; use --help');
  const o = { artifacts: [], positional: [] }, seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--' && command === 'run') { o.command = args.slice(i + 1); break; }
    if (!arg.startsWith('-')) { o.positional.push(arg); continue; }
    const key = arg.slice(2);
    if (!arg.startsWith('--') || !flags.includes(key)) throw new Error(`unsupported option: ${arg}`);
    if (seen.has(key) && key !== 'artifact') throw new Error(`duplicate option: ${arg}`);
    seen.add(key);
    const value = args[++i];
    if (value === undefined || value === '' || value.startsWith('--')) throw new Error(`${arg} requires a nonempty value`);
    if (key === 'artifact') o.artifacts.push(value); else o[key] = value;
  }
  if ((command === 'verify' || command === 'report') ? o.positional.length !== 1 : o.positional.length) throw new Error('unexpected or missing positional argument');
  return o;
}
export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv[0] === '--help' || argv[0] === '-h' || argv.slice(1).includes('--help') && !argv.includes('--')) { console.log(HELP); return 0; }
  if (argv[0] === '--version') { console.log('0.10.0'); return 0; }
  const [cmd, ...rest] = argv, o = parse(cmd, rest);
  if (cmd === 'run') {
    if (!o.command?.length) throw new Error('run requires -- PROGRAM [ARG ...]');
    // Refuse an existing destination before any user command can run.
    if (o.out) absent(o.out);
    const privateKey = o['sign-key'] ? boundedRead(o['sign-key'], 16384).toString('utf8') : null;
    // Validate the key before executing commands.
    if (privateKey !== null) loadPrivateKey(privateKey);
    const root = resolve(o.root ?? '.');
    const receipt = await runLedger({ task: o.task, program: o.command[0], args: o.command.slice(1), root,
      cwd: o.cwd, artifacts: o.artifacts, agent: o.agent, client: o.client, clientContext: o['client-context'], processScope: o['process-scope'],
      timeoutMs: o.timeout === undefined ? undefined : Number(o.timeout), maxOutputBytes: o['max-output'] === undefined ? undefined : Number(o['max-output']) });
    if (privateKey !== null) signReceipt(receipt, privateKey);
    let out = o.out;
    if (!out) { const dir = join(root, '.test-ledger'); mkdirSync(dir, { recursive: true }); out = join(dir, receipt.id + '.json'); }
    exclusiveWrite(out, JSON.stringify(receipt, null, 2) + '\n');
    const verification = verifyLedger(receipt, { root });
    console.log(JSON.stringify({ receipt: out, process: receipt.process.status, processControl: receipt.processControl, tests: receipt.tests, freshness: verification.freshness }));
    return receipt.tests.status === 'passed' && receipt.process.exitCode === 0 && receipt.process.signal === null && cleanupAllowsEvidence(receipt.processControl) && !receipt.artifacts.some(a => a.changedDuringRun) ? 0 : 1;
  }
  if (cmd === 'keygen') {
    if (!o['out-dir']) throw new Error('keygen requires --out-dir DIR');
    const dir = o['out-dir'], priv = join(dir, 'private.pem'), pub = join(dir, 'public.pem');
    absent(priv); absent(pub);
    const keys = generateKeys(); mkdirSync(dir, { recursive: true });
    exclusiveWrite(priv, keys.privatePem); exclusiveWrite(pub, keys.publicPem);
    console.log('Created Ed25519 private.pem (keep secret) and public.pem.'); return 0;
  }
  if (cmd === 'report') { if (!o.out) throw new Error('report requires --out FILE'); absent(o.out); }
  const receipt = readReceipt(o.positional[0]);
  const result = verifyLedger(receipt, { root: resolve(o.root ?? '.'), publicKeyPem: o.pubkey ? boundedRead(o.pubkey, 16384).toString('utf8') : undefined });
  if (cmd === 'report') exclusiveWrite(o.out, renderReport(receipt, result));
  console.log(JSON.stringify(result));
  return result.valid && result.freshness !== 'stale' ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  if (Number(process.versions.node.split('.')[0]) < 22) { console.error('Node.js >=22 is required'); process.exitCode = 2; }
  else main().then(code => { process.exitCode = code; }).catch(e => { console.error(`ledger: ${String(e.message).replace(/[\x00-\x1f\x7f]/g, ' ')}`); process.exitCode = 2; });
}
