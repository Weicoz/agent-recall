import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreRecord } from '../lib/search.mjs';

test('scoreRecord: evaluates field weights properly', () => {
  const rec = {
    title: 'Deploy to Cloudflare Workers',
    keywords: ['wrangler', 'kv', 'deploy'],
    artifacts: ['wrangler.toml', 'worker.js'],
    summary: 'Automated deployment using git actions',
    userTexts: ['How do I deploy this worker to cloudflare?'],
    status: '已完成',
  };

  // Title match: 6 points
  const sTitle = scoreRecord(rec, ['workers']);
  assert.equal(sTitle.total, 6);
  assert.ok(sTitle.hits[0].includes('标题'));

  // Keywords match: 5 points
  const sKw = scoreRecord(rec, ['wrangler']);
  assert.equal(sKw.total, 5);
  assert.ok(sKw.hits[0].includes('关键词'));

  // Artifacts match: 4 points
  const sArt = scoreRecord(rec, ['wrangler.toml']);
  assert.equal(sArt.total, 4);
  assert.ok(sArt.hits[0].includes('产出物'));

  // Summary match: 3 points
  const sSum = scoreRecord(rec, ['automated']);
  assert.equal(sSum.total, 3);
  assert.ok(sSum.hits[0].includes('摘要'));

  // User query match: 2 points
  const sUser = scoreRecord(rec, ['how']);
  assert.equal(sUser.total, 2);
  assert.ok(sUser.hits[0].includes('提问原文'));

  // Status match: 1 point
  const sStatus = scoreRecord(rec, ['已完成']);
  assert.equal(sStatus.total, 1);
  assert.ok(sStatus.hits[0].includes('状态'));

  // Multiple matches
  const sMulti = scoreRecord(rec, ['workers', 'wrangler']);
  assert.equal(sMulti.total, 11);
});

test('isUnfinishedSession: correctly classifies in-progress, interrupted, and leftover work', async () => {
  const { isUnfinishedSession, searchSessions } = await import('../lib/search.mjs');

  assert.equal(isUnfinishedSession({ status: '进行中' }), true);
  assert.equal(isUnfinishedSession({ status: '中断' }), true);
  assert.equal(isUnfinishedSession({ status: '待继续' }), true);
  assert.equal(isUnfinishedSession({ status: '已完成' }), false);
  assert.equal(isUnfinishedSession({ status: '仅咨询' }), false);

  // Summary with leftover markers
  assert.equal(isUnfinishedSession({ status: '已完成', summary: '核心功能已做完，遗留：配置项未同步' }), true);
  assert.equal(isUnfinishedSession({ status: '已完成', summary: '下一步需要继续开发' }), true);
  assert.equal(isUnfinishedSession({ status: '已完成', summary: '所有功能均已开发并通过测试' }), false);

  // Search with unfinished: true
  const res = await searchSessions([], { unfinished: true, limit: 10 });
  assert.ok(res.results.length > 0);
  for (const item of res.results) {
    assert.equal(item.isUnfinished, true);
    assert.ok(item.lastTime > 0);
    assert.ok(typeof item.lastTimeFormatted === 'string');
    assert.ok(typeof item.relativeTime === 'string');
    assert.ok(typeof item.status === 'string');
  }
});
