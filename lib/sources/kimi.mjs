import { readdir, stat, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';

import { mapLimit, projectKey, projectLabel, isActive } from '../session-source.mjs';
import { eachJsonLine, countBy, clipTitle, toMs, isAutomatedOrHeadlessText } from '../parse.mjs';

export const META = { id: 'kimi', label: 'Kimi Code' };

export const KIMI_ROOT = process.env.AGENT_RECALL_KIMI_ROOT
  || process.env.SESSION_RECALL_KIMI_ROOT
  || join(homedir(), '.kimi-code');

export const SESSIONS_ROOT = join(KIMI_ROOT, 'sessions');
export const INDEX_PATH = join(KIMI_ROOT, 'session_index.jsonl');

export const EMPTY_KIMI_BYTES = Number(process.env.AGENT_RECALL_KIMI_MIN_BYTES ?? 1000);

export async function loadSessionIndex(indexPath = INDEX_PATH) {
  const map = new Map();
  if (!existsSync(indexPath)) return map;
  try {
    const text = await readFile(indexPath, 'utf8');
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line);
        if (j.sessionId) {
          map.set(j.sessionId, j);
        }
      } catch {}
    }
  } catch {}
  return map;
}

export async function isHeadlessFile(file) {
  let headless = false;
  let checked = false;
  try {
    await eachJsonLine(file, (j) => {
      if (j.type === 'turn.prompt') {
        checked = true;
        const inp = j.input;
        let text = '';
        if (Array.isArray(inp)) {
          text = inp.filter((p) => p && p.type === 'text').map((p) => p.text || '').join('\n');
        } else if (typeof inp === 'string') {
          text = inp;
        }
        if (isAutomatedOrHeadlessText(text)) {
          headless = true;
        }
        return false;
      }
    }, 2_000_000);
  } catch {
    return true;
  }
  return checked ? headless : false;
}

function cleanUserRequest(content) {
  let text = String(content || '').trim();
  if (!text) return '';

  const argBlockMatch = text.match(/ARGUMENTS:\s*([\s\S]*?)<\/(?:kimi-)?skill-loaded>/i);
  if (argBlockMatch) {
    const skillNameMatch = text.match(/<(?:kimi-)?skill-loaded[^>]*name=\"([^\"]+)\"/i);
    const skillPrefix = skillNameMatch ? `/${skillNameMatch[1]} ` : '';
    text = (skillPrefix + argBlockMatch[1].trim()).trim();
  } else {
    const m = text.match(/<(?:kimi-)?skill-loaded[^>]*name=\"([^\"]+)\"[^>]*args=\"([^\"]*)\"/i);
    if (m) {
      const skillName = m[1];
      const args = m[2].trim();
      text = (`/${skillName} ${args}`).trim();
    }
  }
  return text;
}

export async function scanSessions({ known = {}, minBytes = EMPTY_KIMI_BYTES } = {}) {
  if (!existsSync(SESSIONS_ROOT)) return [];
  let wdDirs;
  try { wdDirs = await readdir(SESSIONS_ROOT); } catch { return []; }

  const sessionFiles = [];
  for (const wd of wdDirs) {
    if (!wd.startsWith('wd_')) continue;
    const wdPath = join(SESSIONS_ROOT, wd);
    let sDirs;
    try { sDirs = await readdir(wdPath); } catch { continue; }
    for (const s of sDirs) {
      if (!s.startsWith('session_')) continue;
      const wirePath = join(wdPath, s, 'agents', 'main', 'wire.jsonl');
      sessionFiles.push({
        id: s.replace(/^session_/, ''),
        wirePath,
        sessionDir: join(wdPath, s),
      });
    }
  }

  const indexMap = await loadSessionIndex();

  const rows = await mapLimit(sessionFiles, 24, async ({ id, wirePath, sessionDir }) => {
    let st;
    try { st = await stat(wirePath); } catch { return null; }

    const key = `${META.id}:${id}`;
    const prior = known[key];
    if (!prior && st.size < minBytes) return null;

    let headless = prior?.headless;
    if (headless === undefined) headless = await isHeadlessFile(wirePath);

    const cached = !!prior && (prior.ok || prior.empty || prior.headless)
      && (!prior.headless === !headless)
      && prior.bytes === st.size
      && Math.abs((prior.mtime || 0) - st.mtimeMs) <= 1000;

    return {
      key,
      source: META.id,
      id,
      file: wirePath,
      sessionDir,
      bytes: st.size,
      mtimeMs: st.mtimeMs,
      version: 'wire.jsonl',
      isNew: !prior,
      cached,
      active: isActive(st.mtimeMs),
      headless,
      prior: prior || null,
      indexFallback: indexMap.get(id) || null,
    };
  });
  return rows.filter(Boolean);
}

export async function parseSession(entry) {
  let cwd = '';
  let title = '';
  const statePath = join(entry.sessionDir || dirname(dirname(dirname(entry.file))), 'state.json');
  try {
    const raw = await readFile(statePath, 'utf8');
    const st = JSON.parse(raw);
    cwd = st.workDir || st.cwd || '';
    title = st.title || '';
  } catch {}

  if (!cwd && entry.indexFallback?.workDir) {
    cwd = entry.indexFallback.workDir;
  }

  let turns = 0;
  let firstTime = 0;
  let lastTime = 0;
  const userMsgs = [];
  const assistantTexts = [];
  const toolNames = [];

  await eachJsonLine(entry.file, (j) => {
    const t = toMs(j.timestamp || j.time);
    if (t) { if (!firstTime) firstTime = t; lastTime = t; }

    if (j.type === 'turn.prompt') {
      const inp = j.input;
      let text = '';
      if (Array.isArray(inp)) {
        text = inp.filter((p) => p && p.type === 'text').map((p) => p.text || '').join('\n');
      } else if (typeof inp === 'string') {
        text = inp;
      }
      text = cleanUserRequest(text);
      if (text && !isAutomatedOrHeadlessText(text)) {
        userMsgs.push(text);
      }
    } else if (j.type === 'context.append_loop_event') {
      const ev = j.event || {};
      if (ev.type === 'content.part' && ev.part?.type === 'text') {
        turns++;
        const text = String(ev.part.text || '').trim();
        if (text) assistantTexts.push(text);
      } else if (ev.type === 'tool.call' && ev.name) {
        toolNames.push(ev.name);
      }
    }
  });

  if (!title) {
    title = clipTitle(userMsgs[0] || '');
  }

  return {
    meta: {
      sessionId: entry.id,
      cwd,
      projectKey: cwd ? projectKey(cwd) : '',
      projectLabel: projectLabel(cwd, META.label),
    },
    title,
    userMsgs,
    assistantTexts,
    tools: countBy(toolNames),
    turns,
    firstTime,
    lastTime,
    empty: userMsgs.length === 0,
  };
}

export function resumeCommand(rec) {
  const cmd = `kimi --session ${rec.id}`;
  return rec.cwd ? `cd ${rec.cwd} && ${cmd}` : cmd;
}
