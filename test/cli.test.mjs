import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const CLI = join(process.cwd(), 'bin', 'cli.mjs');

test('CLI: --version outputs package version', () => {
  const out = execFileSync(process.execPath, [CLI, '--version'], { encoding: 'utf8' });
  assert.ok(out.includes('agent-recall'));
  assert.ok(out.includes('1.0.0'));
});

test('CLI: --help prints command reference', () => {
  const out = execFileSync(process.execPath, [CLI, '--help'], { encoding: 'utf8' });
  assert.ok(out.includes('USAGE:'));
  assert.ok(out.includes('recall <keywords...>'));
  assert.ok(out.includes('Claude Code'));
  assert.ok(out.includes('Codex'));
  assert.ok(out.includes('Antigravity'));
});

test('CLI: config displays configuration without error', () => {
  const out = execFileSync(process.execPath, [CLI, 'config'], { encoding: 'utf8' });
  assert.ok(out.includes('Agent Recall Configuration'));
  assert.ok(out.includes('Data Directory:'));
});

test('CLI: status returns breakdown of harnesses', () => {
  const out = execFileSync(process.execPath, [CLI, 'status'], { encoding: 'utf8' });
  assert.ok(out.includes('Agent Recall Status'));
  assert.ok(out.includes('Total Indexed Sessions'));
  assert.ok(out.includes('Claude Code'));
  assert.ok(out.includes('Codex'));
});
