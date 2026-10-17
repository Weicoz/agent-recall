import { loadState, isLockActive, DATA_DIR } from './store.mjs';
import { currentProjectKey } from './session-source.mjs';
import { sourceLabel, resumeCommand } from './harness.mjs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { openSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Calculate score for an individual session against search terms. */
export function scoreRecord(rec, terms) {
  const hay = {
    title: (rec.title || '').toLowerCase(),
    keywords: (rec.keywords || []).join(' ').toLowerCase(),
    artifacts: (rec.artifacts || []).join(' ').toLowerCase(),
    summary: (rec.summary || '').toLowerCase(),
    user: (rec.userTexts || []).join(' ').toLowerCase(),
    status: (rec.status || '').toLowerCase(),
  };

  let total = 0;
  const hits = [];

  for (const t of terms) {
    let best = 0;
    let where = '';
    if (hay.title.includes(t)) { best = 6; where = '标题'; }
    else if (hay.keywords.includes(t)) { best = 5; where = '关键词'; }
    else if (hay.artifacts.includes(t)) { best = 4; where = '产出物'; }
    else if (hay.summary.includes(t)) { best = 3; where = '摘要'; }
    else if (hay.user.includes(t)) { best = 2; where = '提问原文'; }
    else if (hay.status.includes(t)) { best = 1; where = '状态'; }

    if (best) {
      total += best;
      hits.push(`${t}(${where})`);
    }
  }

  return { total, hits };
}

/**
 * Search sessions with project prioritization and term weighting.
 */
export async function searchSessions(queryTerms, options = {}) {
  const {
    project = '',
    source = '',
    limit = 5,
    all = false,
    currentCwd = process.cwd(),
  } = options;

  const state = await loadState();
  const records = Object.values(state.sessions || {}).filter((r) => r.ok && !r.empty && !r.headless);

  const curKey = currentProjectKey(currentCwd);
  const terms = queryTerms.map((t) => t.toLowerCase()).filter(Boolean);

  let pool = records;
  if (source) {
    pool = pool.filter((r) => r.source === source);
  }
  if (project) {
    const pLow = project.toLowerCase();
    pool = pool.filter((r) => (r.project || '').toLowerCase().includes(pLow) || (r.projectLabel || '').toLowerCase().includes(pLow));
  }

  // Score each candidate
  const scored = [];
  for (const r of pool) {
    const s = terms.length ? scoreRecord(r, terms) : { total: 1, hits: [] };
    if (s.total > 0) {
      const isCur = (r.project === curKey);
      scored.push({
        ...r,
        sourceLabel: sourceLabel(r.source),
        resume: resumeCommand(r),
        score: s.total + (isCur && !all ? 10 : 0), // Boost current project
        rawScore: s.total,
        matchedFields: s.hits,
        isCurrentProject: isCur,
      });
    }
  }

  // Sort by score desc, then by time desc
  scored.sort((a, b) => b.score - a.score || (b.time || 0) - (a.time || 0));

  // If not --all, and we have hits in current project, check whether current project alone suffices
  let results = scored;
  if (!all && !project && terms.length > 0) {
    const curProjectHits = scored.filter((r) => r.isCurrentProject);
    if (curProjectHits.length > 0) {
      results = curProjectHits;
    }
  }

  return {
    totalIndexed: records.length,
    matchedCount: scored.length,
    results: results.slice(0, limit),
    isCurrentProjectOnly: !all && !project && results.length > 0 && results[0].isCurrentProject,
  };
}

/** Non-blocking background trigger for incremental digest. */
export async function triggerBackgroundDigest(binDir) {
  if (await isLockActive()) return { mode: 'running' };

  try {
    const logFd = openSync(join(DATA_DIR, 'digest.log'), 'a');
    const digestScript = join(binDir, 'digest.mjs');
    const child = spawn(process.execPath, [digestScript, '--quiet'], {
      detached: true,
      stdio: ['ignore', logFd, logFd],
      env: process.env,
    });
    child.unref();
    return { mode: 'spawned', pid: child.pid };
  } catch (err) {
    return { mode: 'error', error: err.message };
  }
}
