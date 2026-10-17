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
    assistantTexts: [
      '已修复事务提交问题，并将每批次提交改为即时提交。',
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
  assert.equal(res.isUnfinished, false);
  assert.ok(res.artifacts.includes('Pro/Sources/OilFindPro/ContentManager.swift'));
});

test('generateZeroLlmSummary: correctly detects unfinished and interrupted sessions', () => {
  // Interrupted (no assistant reply)
  const interrupted = generateZeroLlmSummary({
    title: '未回答的请求',
    userMsgs: ['请帮我排查这个问题'],
    assistantTexts: [],
  });
  assert.equal(interrupted.status, '中断');
  assert.equal(interrupted.isUnfinished, true);

  // Leftover markers
  const leftover = generateZeroLlmSummary({
    title: '部分完成的任务',
    userMsgs: ['优化数据库性能'],
    assistantTexts: ['数据库索引已加好。遗留：数据归档脚本尚未编写，下一步需要继续验证。'],
  });
  assert.equal(leftover.status, '待继续');
  assert.equal(leftover.isUnfinished, true);
});
