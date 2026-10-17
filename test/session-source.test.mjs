import test from 'node:test';
import assert from 'node:assert/strict';
import { projectKey, projectLabel, isActive, VERSION_ORDER } from '../lib/session-source.mjs';

test('projectKey: converts paths to safe keys with leading/trailing dashes', () => {
  assert.equal(
    projectKey('/Users/weicoz/File/git/LLM-wiki'),
    '--Users-weicoz-File-git-LLM-wiki--'
  );
  assert.equal(
    projectKey('/Users/weicoz/Desktop'),
    '--Users-weicoz-Desktop--'
  );
  assert.equal(projectKey(''), '--root--');
});

test('projectKey: handles Chinese and special characters using ~XXXX encoding', () => {
  const key = projectKey('/Users/weicoz/工作目录');
  assert.match(key, /^--Users-weicoz-(?:~[0-9A-F]{4}){4}--$/);
});

test('projectLabel: extracts basename or falls back', () => {
  assert.equal(projectLabel('/Users/weicoz/File/git/LLM-wiki'), 'LLM-wiki');
  assert.equal(projectLabel('', 'fallback'), 'fallback');
});

test('isActive: detects recent modification timestamp', () => {
  const now = Date.now();
  assert.equal(isActive(now - 5000, now), true);
  assert.equal(isActive(now - 60000, now), false);
});

test('VERSION_ORDER: maintains correct priority sequence', () => {
  assert.deepEqual(VERSION_ORDER, [
    'session.v4.jsonl.zstd',
    'session.v3.jsonl.zstd',
    'session.v2.jsonl.zstd',
    'session.jsonl.zstd',
  ]);
});
