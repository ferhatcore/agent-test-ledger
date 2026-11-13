// Copyright (c) 2026 Ferhat Kosger. MIT License.
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function renderReport(receipt, verification) {
  // Invalid records are rendered only as escaped JSON; never trust their shape.
  const row = (k, v) => `<tr><th scope="row">${escape(k)}</th><td>${escape(v)}</td></tr>`;
  let content;
  if (verification.integrity !== 'consistent') {
    content = `<h1>Invalid test record</h1><p>This record cannot be used as test evidence.</p><pre>${escape(JSON.stringify(receipt, null, 2))}</pre>`;
  } else {
    const r = receipt, v = verification;
    const reasons = v.currentTestEvidence ? [] : [
      r.tests.status !== 'passed' && `test result is ${r.tests.status}`,
      r.tests.status === 'passed' && r.tests.emptyFiles !== 0 && 'empty test file check not recorded',
      r.process.status !== 'completed' && `process ${r.process.status}`,
      r.process.status === 'completed' && r.process.exitCode !== 0 && `exit code ${r.process.exitCode ?? 'none'}`,
      v.freshness !== 'current' && `listed files are ${v.freshness}`,
      !v.valid && 'verification problems (see below)',
    ].filter(Boolean);
    content = `<h1>Agent Test Ledger</h1>${v.currentTestEvidence
      ? '<p class="status ok"><span class="mark">PASS</span> Current passing evidence for listed files</p>'
      : `<div class="status bad"><p><span class="mark">NO EVIDENCE</span> No current passing test evidence</p>${reasons.length ? `<ul>${reasons.map(x => `<li>${escape(x)}</li>`).join('')}</ul>` : ''}</div>`}
<h2>${escape(r.task)}</h2><table>${[
      ['Record ID', r.id], ['Program and arguments (JSON)', JSON.stringify([r.command.program, ...r.command.args])],
      ['Working directory (relative to supplied project root)', r.workingDirectory], ['Started (UTC)', r.startedAt], ['Ended (UTC)', r.endedAt],
      ['Duration', `${r.process.durationMs} ms`], ['Process result', r.process.status], ['Exit code', r.process.exitCode ?? 'none'],
      ['Signal', r.process.signal ?? 'none'], ['Launch error', r.process.errorCode ?? 'none'], ['Timed out', r.process.timedOut],
      ['Test result', r.tests.status], ['Test counts', r.tests.counts ? JSON.stringify(r.tests.counts) : 'unknown'],
      ['Test files without tests', r.tests.emptyFiles === undefined ? 'not recorded (older record; not current evidence)' : r.tests.emptyFiles ?? 'unknown'],
      ['Test parser', r.tests.parser], ['Listed file freshness', v.freshness], ['Integrity', v.integrity], ['Signature', v.signature],
      ['Runner report', r.tests.report ? `${r.tests.report.path}; SHA-256 ${r.tests.report.sha256}` : 'not used'],
      ['Agent label', `${r.labels.agent.value} (${r.labels.agent.source})`], ['Client label', `${r.labels.client.value} (${r.labels.client.source})`],
      ['Git before run', JSON.stringify(r.git)], ['Output hash scope', r.output.hashScope],
      ['Standard output', `${r.output.stdout.bytes} captured bytes; SHA-256 ${r.output.stdout.sha256}`],
      ['Standard error', `${r.output.stderr.bytes} captured bytes; SHA-256 ${r.output.stderr.sha256}`],
    ].map(([k, val]) => row(k, val)).join('')}</table>
<h2>Related files</h2>${v.files.length ? `<table>${v.files.map(f => row(f.path, f.state)).join('')}</table>` : '<p>No files tracked. Freshness is unknown for project contents.</p>'}
<h2>Limits of this record</h2><ul><li>Labels are user supplied. They do not prove a Claude or Codex session ran.</li><li>A hash checks consistency. A signature checks possession of the supplied key. Neither proves honest execution.</li><li>Only explicitly listed files are checked. Before/after snapshots cannot detect changes that were reverted during the run.</li><li>Test counts describe recognized Node TAP output or a Jest/Vitest JSON report; a malicious command can forge either.</li><li>Raw output is not stored. No secret removal guarantee is provided for task names, arguments or paths.</li><li>The command ran with the user's permissions. This tool is not a sandbox and does not guarantee descendant process termination.</li><li>Opening this static report does not refresh file hashes. Regenerate it to check again.</li></ul>`;
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Agent Test Ledger report</title><style>body{font:16px/1.55 system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1rem;color:#172d36;background:#f5f7f8}h1,h2{line-height:1.2}h1{font-size:2rem}h2{margin-top:2rem;font-size:1.3rem}table{border-collapse:collapse;width:100%;background:white}th,td{text-align:left;vertical-align:top;padding:.65rem;border-bottom:1px solid #ced9dd;overflow-wrap:anywhere}th{width:31%}.status{border-left:6px solid;padding:1rem;font-weight:bold}.status p{margin:0}.status ul{margin:.5rem 0 0;font-weight:normal}.ok{border-color:#1f7a3d;background:#e3f3e8}.bad{border-color:#b3261e;background:#fbe9e7}.mark{display:inline-block;margin-right:.5rem;padding:.1rem .45rem;border-radius:3px;color:#fff;font-size:.8rem;letter-spacing:.04em}.ok .mark{background:#1f7a3d}.bad .mark{background:#b3261e}pre{white-space:pre-wrap;overflow-wrap:anywhere}li{margin:.5rem 0}@media(max-width:550px){body{margin:1rem auto}th,td{display:block;width:auto}th{border:0;padding-bottom:0}}</style></head><body>${content}<h2>Verification issues</h2>${verification.problems.length ? `<ul>${verification.problems.map(p => `<li>${escape(p)}</li>`).join('')}</ul>` : '<p>No integrity or requested signature errors. This does not imply tests passed or files are current.</p>'}</body></html>\n`;
}
