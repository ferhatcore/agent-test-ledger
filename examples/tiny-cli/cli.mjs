// Minimal greeting CLI used by the quickstart example.
import { pathToFileURL } from 'node:url';
export function greet(name) { return `Hello, ${name.trim() || 'world'}!`; }
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(greet(process.argv[2] ?? 'world'));
