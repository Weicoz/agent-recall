import test from 'node:test';
import assert from 'node:assert/strict';
import { generateZeroLlmSummary } from '../lib/llm.mjs';

test('generateZeroLlmSummary: produces clean summary, keywords, and artifacts', () => {
  const parsed = {
    title: '修复 FTS5 数据库事务提交问题',
    userMsgs: [
      '在 Pro/Sources/OilFindPro/ContentManager.swift 里面为什么每50条才提交事务？',
      '查看一下 SQLite 锁的状态。',
    ],
    tools: {
      view_file: 3,
      run_command: 2,
    },
    meta: {
      projectLabel: 'oil-find-plus',
      cwd: '/Users/weicoz/File/git/oil-find-plus',
    },
  };

  const res = generateZeroLlmSummary(parsed);
  assert.ok(res.title.includes('修复 FTS5'));
  assert.ok(res.summary.includes('会话'));
  assert.ok(res.keywords.includes('view_file'));
  assert.ok(res.keywords.includes('run_command'));
  assert.equal(res.status, '已完成');
  assert.ok(res.artifacts.includes('Pro/Sources/OilFindPro/ContentManager.swift'));
});
