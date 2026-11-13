// Copyright (c) 2026 Ferhat Kosger. MIT License.
import { MAX_REPORT } from './runners.mjs';

/** Recognizes direct Python module execution with one explicit JUnit destination. */
export function pytestRunner(command) {
  const args = command?.args;
  if (typeof command?.program !== 'string' || !/^python(?:3(?:\.\d+)?)?(?:\.exe)?$/i.test(command.program.split(/[\\/]/).at(-1)) ||
      !Array.isArray(args) || args.some(a => typeof a !== 'string') || args[0] !== '-m' || args[1] !== 'pytest') return null;
  const rest = args.slice(2), files = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--' || /^(?:--collect-only|--co|--help|--version|--fixtures|--funcargs|--fixtures-per-test|--cache-show|--trace-config|--markers|--setup-plan|--setup-only)(?:=|$)/.test(a) || /^-[^-]*[hV]/.test(a)) return null;
    if (/^--(?:junit-xml|junitxml)=/.test(a)) files.push(a.slice(a.indexOf('=') + 1));
    else if (/^--(?:junit-xml|junitxml)$/.test(a)) files.push(rest[++i] ?? '');
  }
  return files.length === 1 && files[0] && !files[0].startsWith('-') ? { runner: 'pytest', outputFile: files[0] } : null;
}

// A deliberately small XML grammar for pytest's built-in reporter. No DTDs,
// custom entities, namespaces, CDATA or processing instructions are accepted.
function xml(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_REPORT || /[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/u.test(text)) throw Error();
  text = text.replace(/^\uFEFF/, '').replace(/^<\?xml version="1\.0" encoding="[uU][tT][fF]-8"\?>/, '');
  const decode = s => s.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);|&/g, entity => {
    if (entity === '&') throw Error();
    if (entity[1] !== '#') return ({'&amp;':'&', '&lt;':'<', '&gt;':'>', '&quot;':'"', '&apos;':"'"})[entity];
    const n = entity[2] === 'x' ? parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1));
    if (!(n === 9 || n === 10 || n === 13 || n >= 32 && n <= 0xd7ff || n >= 0xe000 && n <= 0xfffd || n >= 0x10000 && n <= 0x10ffff)) throw Error();
    return String.fromCodePoint(n);
  });
  const allowed = { testsuites: ['testsuite'], testsuite: ['testcase', 'properties'], testcase: ['failure', 'error', 'skipped', 'properties', 'system-out', 'system-err'], properties: ['property'], property: [], failure: [], error: [], skipped: [], 'system-out': [], 'system-err': [] };
  const stack = [], roots = []; let offset = 0, nodes = 0;
  while (offset < text.length) {
    if (text[offset] !== '<') {
      let end = text.indexOf('<', offset); if (end < 0) end = text.length;
      const content = text.slice(offset, end); decode(content);
      if (content.includes(']]>') || /[^ \t\r\n]/.test(content) && !['failure', 'error', 'skipped', 'system-out', 'system-err'].includes(stack.at(-1)?.tag)) throw Error();
      offset = end; continue;
    }
    const close = /^<\/([a-z][a-z-]*)[ \t\r\n]*>/.exec(text.slice(offset));
    if (close) { if (stack.pop()?.tag !== close[1]) throw Error(); offset += close[0].length; continue; }
    const start = /^<([a-z][a-z-]*)(?=[ \t\r\n/>])/.exec(text.slice(offset));
    if (!start || !Object.hasOwn(allowed, start[1]) || stack.length >= 5 || ++nodes > 200000) throw Error();
    offset += start[0].length;
    const node = { tag: start[1], attrs: Object.create(null), children: [] };
    while (!/^[ \t\r\n]*\/?>/.test(text.slice(offset))) {
      const attr = /^[ \t\r\n]+([A-Za-z_][A-Za-z0-9_.-]*)[ \t\r\n]*=[ \t\r\n]*(?:"([^"<]*)"|'([^'<]*)')/.exec(text.slice(offset));
      if (!attr || Object.hasOwn(node.attrs, attr[1])) throw Error();
      node.attrs[attr[1]] = decode(attr[2] ?? attr[3]); offset += attr[0].length;
    }
    const end = /^[ \t\r\n]*(\/?)>/.exec(text.slice(offset)); offset += end[0].length;
    const parent = stack.at(-1);
    if (parent) { if (!allowed[parent.tag].includes(node.tag)) throw Error(); parent.children.push(node); }
    else { if (roots.length || node.tag !== 'testsuites') throw Error(); roots.push(node); }
    if (!end[1]) stack.push(node);
  }
  if (stack.length || roots.length !== 1 || roots[0].children.length !== 1 || Object.keys(roots[0].attrs).some(k => k !== 'name')) throw Error();
  return roots[0].children[0];
}

/** Counts testcase outcomes, validating pytest's aggregate outcome markers. */
export function parsePytestReport(text, exitCode) {
  try {
    if (!Number.isInteger(exitCode) || exitCode < 0 || exitCode > 6) return null;
    const suite = xml(text), counts = { total: 0, passed: 0, failed: 0, cancelled: 0, skipped: 0, todo: 0 };
    if (suite.children.filter(c => c.tag === 'properties').length > 1) return null;
    const markers = { failures: 0, errors: 0, skipped: 0 };
    for (const c of suite.children.filter(c => c.tag === 'testcase')) {
      if (typeof c.attrs.name !== 'string') return null;
      const outcomes = c.children.filter(n => ['failure', 'error', 'skipped'].includes(n.tag));
      if (c.children.filter(n => n.tag === 'properties').length > 1 || new Set(outcomes.map(n => n.tag)).size !== outcomes.length || outcomes.some(n => n.tag === 'failure') && outcomes.length > 1) return null;
      for (const n of outcomes) markers[{failure:'failures', error:'errors', skipped:'skipped'}[n.tag]]++;
      counts.total++;
      if (outcomes.some(n => n.tag === 'failure' || n.tag === 'error')) counts.failed++;
      else if (outcomes.length) counts.skipped++;
      else counts.passed++;
    }
    for (const [key, value] of Object.entries({ tests: counts.total, ...markers })) {
      const s = suite.attrs[key];
      if (!/^(?:0|[1-9]\d*)$/.test(s ?? '') || !Number.isSafeInteger(Number(s)) || Number(s) !== value) return null;
    }
    if (exitCode === 0 && counts.failed || exitCode === 5 && counts.total) return null;
    return counts;
  } catch { return null; }
}
