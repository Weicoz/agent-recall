import { mkdir } from 'node:fs/promises';
import { SOURCES, migrateLegacyState, parseEntry, scanAll } from './harness.mjs';
import { buildPrompt, callModel, generateZeroLlmSummary } from './llm.mjs';
import { resolveLlmConfig } from './config.mjs';
import {
  DETAIL_DIR, INDEX_FILE, PROJECTS_FILE, STATE_FILE, acquireLock, detailPath, loadProjects,
  loadState, localTime, readJson, releaseLock, renderDetail, renderIndex, touchProject, writeAtomic,
} from './store.mjs';

const FLUSH_EVERY = Number(process.env.AGENT_RECALL_FLUSH || 5);

export async function runDigest(options = {}) {
  const {
    force = false,
    dry = false,
    renderOnly = false,
    quiet = false,
    includeActive = false,
    limit = 0,
    only = '',
    projectFilter = '',
    sourceFilter = '',
    minMsgs = 1,
    llmConfig = null,
  } = options;

  function log(...a) { if (!quiet) console.log(...a); }

  if (!dry && !(await acquireLock())) {
    log('⚠️  Another digest task is currently running. Skipping.');
    return { ok: false, reason: 'locked' };
  }

  try {
    const state = await loadState();
    const migrated = migrateLegacyState(state);
    if (migrated > 0) {
      log(`🔄 Migrated ${migrated} legacy records with harness prefixes.`);
    }

    const projects = await loadProjects();
    const all = await scanAll({ known: state.sessions, only: sourceFilter || null });
    const records = { ...state.sessions };
    const candidates = [];
    const counts = {};
    let activeSkipped = 0;

    const pFilter = projectFilter.toLowerCase();

    for (const e of all) {
      counts[e.source] = (counts[e.source] || 0) + 1;
      const key = e.key;
      const prior = e.prior || state.sessions[key];
      const label = projects[e.project]?.label || prior?.projectLabel || '';

      if (prior) {
        records[key] = {
          ...prior,
          key,
          source: e.source,
          project: e.project || prior.project,
          projectLabel: label || prior.projectLabel,
          cached: true,
        };
      }

      if (pFilter && !e.project?.toLowerCase().includes(pFilter)) continue;
      if (only && !e.id.includes(only)) continue;
      if (e.headless) continue;

      if (!includeActive && e.active) {
        activeSkipped++;
        continue;
      }

      if (force || !e.cached) {
        candidates.push(e);
      }
    }

    const summaryParts = Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(' | ');
    log(`📊 Discovered ${all.length} sessions (${summaryParts}).`);
    log(`🎯 Candidates needing digest: ${candidates.length}${activeSkipped ? ` (${activeSkipped} active sessions deferred)` : ''}`);

    if (renderOnly) {
      if (!dry) {
        await writeAtomic(INDEX_FILE, renderIndex(records, projects));
      }
      log('✅ Rendered index.md only.');
      return { ok: true, candidatesCount: candidates.length, processed: 0 };
    }

    if (dry) {
      log('ℹ️ Dry-run completed.');
      return { ok: true, candidatesCount: candidates.length, processed: 0 };
    }

    const effectiveLlm = llmConfig || resolveLlmConfig();
    if (effectiveLlm.zeroLlm) {
      log('⚡ Running in Zero-LLM local mode (ultra-fast deterministic indexing, zero API cost).');
    } else {
      log(`🤖 Calling LLM API (${effectiveLlm.model} @ ${effectiveLlm.baseUrl})`);
    }

    const queue = limit > 0 ? candidates.slice(0, limit) : candidates;
    let processed = 0;
    let failed = 0;

    await mkdir(DETAIL_DIR, { recursive: true });

    for (let i = 0; i < queue.length; i++) {
      const entry = queue[i];
      const parsed = await parseEntry(entry);

      if (!parsed || parsed.empty || parsed.userMsgs.length < minMsgs) {
        records[entry.key] = {
          key: entry.key,
          source: entry.source,
          id: entry.id,
          time: parsed?.firstTime || entry.mtimeMs,
          empty: true,
          bytes: entry.bytes,
          mtime: entry.mtimeMs,
          version: entry.version,
        };
        continue;
      }

      const pKey = parsed.meta?.projectKey || entry.projectDir || 'root';
      const pLabel = parsed.meta?.projectLabel || pKey;
      touchProject(projects, pKey, parsed.meta?.cwd || '');

      let summaryData = null;
      if (!effectiveLlm.zeroLlm) {
        try {
          const prompt = buildPrompt(parsed);
          summaryData = await callModel(prompt, effectiveLlm);
        } catch (err) {
          log(`⚠️ LLM call failed for ${entry.id}: ${err.message}. Falling back to Zero-LLM mode.`);
        }
      }

      if (!summaryData) {
        summaryData = generateZeroLlmSummary(parsed);
      }

      const isUnfinished = summaryData.isUnfinished ?? (summaryData.status !== '已完成' && summaryData.status !== '仅咨询');
      const rec = {
        key: entry.key,
        source: entry.source,
        id: entry.id,
        project: pKey,
        projectLabel: pLabel,
        cwd: parsed.meta?.cwd || '',
        title: summaryData.title || parsed.title || '无标题会话',
        summary: summaryData.summary || '',
        keywords: summaryData.keywords || [],
        status: summaryData.status || (isUnfinished ? '进行中' : '已完成'),
        isUnfinished,
        statusReason: summaryData.statusReason || (isUnfinished ? '存在未完成或遗留事项' : '已完成全部交互'),
        artifacts: summaryData.artifacts || [],
        tools: parsed.tools || {},
        turns: parsed.turns || 0,
        firstTime: parsed.firstTime || entry.mtimeMs,
        lastTime: parsed.lastTime || entry.mtimeMs,
        time: parsed.firstTime || entry.mtimeMs,
        updatedTime: parsed.lastTime || entry.mtimeMs,
        userTexts: parsed.userMsgs || [],
        bytes: entry.bytes,
        mtime: entry.mtimeMs,
        version: entry.version,
        ok: true,
      };

      records[entry.key] = rec;
      const dPath = detailPath(pKey, entry.id, rec.lastTime || rec.time);
      await writeAtomic(dPath, renderDetail(rec));

      processed++;
      log(`[${processed}/${queue.length}] [${entry.source}] ${pLabel} - ${rec.title}`);

      if (processed % FLUSH_EVERY === 0) {
        state.updatedAt = Date.now();
        state.sessions = records;
        await writeAtomic(STATE_FILE, JSON.stringify(state, null, 2));
        await writeAtomic(PROJECTS_FILE, JSON.stringify(projects, null, 2));
        await writeAtomic(INDEX_FILE, renderIndex(records, projects));
      }
    }

    state.updatedAt = Date.now();
    state.sessions = records;
    await writeAtomic(STATE_FILE, JSON.stringify(state, null, 2));
    await writeAtomic(PROJECTS_FILE, JSON.stringify(projects, null, 2));
    await writeAtomic(INDEX_FILE, renderIndex(records, projects));

    log(`🎉 Done. Processed ${processed} sessions (${failed} errors).`);
    return { ok: true, processed, failed, totalSessions: Object.keys(records).length };
  } finally {
    if (!dry) {
      await releaseLock();
    }
  }
}
