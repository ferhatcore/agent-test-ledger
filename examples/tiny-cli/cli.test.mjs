import { test } from 'node:test';
import assert from 'node:assert/strict';
import { greet } from './cli.mjs';
test('greets a name', () => assert.equal(greet('Ada'), 'Hello, Ada!'));
test('trims surrounding spaces', () => assert.equal(greet(' Ada '), 'Hello, Ada!'));
test('uses world for blank input', () => assert.equal(greet('   '), 'Hello, world!'));
