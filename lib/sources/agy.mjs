import { readdir, stat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

import { mapLimit, projectKey, projectLabel, isActive } from '../session-source.mjs';
import { eachJsonLine, countBy, clipTitle, toMs, isAutomatedOrHeadlessText } from '../parse.mjs';

export const META = { id: 'agy', label: 'Antigravity' };

export const AGY_ROOT = process.env.AGENT_RECALL_AGY_ROOT
  || process.env.SESSION_RECALL_AGY_ROOT
  || join(homedir(), '.gemini', 'antigravity-cli');

export const BRAIN_ROOT = join(AGY_ROOT, 'brain');
export const DB_PATH = join(AGY_ROOT, 'conversation_summaries.db');

export const EMPTY_AGY_BYTES = Number(process.env.AGENT_RECALL_AGY_MIN_BYTES ?? 1200);

async function readHeadBytes(file, maxBytes = 65536) {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } catch { return ''; } finally { await fh.close(); }
}

export async function isHeadlessFile(file) {
  const head = await readHeadBytes(file, 65536);
  if (!head) return true;
  if (isAutomatedOrHeadlessText(head)) return true;
  for (const line of head.split('\n')) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.type === 'SYSTEM_MESSAGE') return true;
    if (j.type === 'USER_INPUT') {
      const content = String(j.content || '');
      if (isAutomatedOrHeadlessText(content)) {
        return true;
      }
      return false;
    }
  }
  return false;
}

export function cwdFromWorkspaceUris(urisJson) {
  if (!urisJson) return '';
  try {
    const arr = JSON.parse(urisJson);
    if (!Array.isArray(arr) || !arr.length) return '';
    const first = arr[0];
    if (typeof first !== 'string') return '';
    if (first.startsWith('file://')) {
      return decodeURIComponent(new URL(first).pathname);
    }
    return first;
  } catch {
    return '';
  }
}

export function loadAgySummaries(dbPath = DB_PATH) {
  const map = new Map();
  if (!existsSync(dbPath)) return map;
  try {
    const out = execFileSync('sqlite3', [
      dbPath,
      'SELECT conversation_id, title, coalesce(workspace_uris,""), coalesce(parent_conversation_id,""), coalesce(nesting_depth,0), coalesce(last_modified_time,"") FROM conversation_summaries;',
    ], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    for (const line of out.split('\n')) {
      if (!line.trim()) continue;
      const [id, title, uris, parentId, depth, mtime] = line.split('|');
      if (id) {
        map.set(id, {
          title: title || '',
          cwd: cwdFromWorkspaceUris(uris),
          parentId: parentId || '',
          nestingDepth: Number(depth || 0),
          lastModifiedTime: mtime || '',
        });
      }
    }
  } catch {}
  return map;
}

function cleanUserRequest(content) {
  let text = String(content || '').trim();
  if (!text) return '';
  const match = text.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
  if (match) {
    text = match[1].trim();
  }
  return text;
}

export async function scanSessions({ known = {}, minBytes = EMPTY_AGY_BYTES } = {}) {
  if (!existsSync(BRAIN_ROOT)) return [];
  let dirs;
  try { dirs = await readdir(BRAIN_ROOT); } catch { return []; }

  const summaries = loadAgySummaries();
  const rows = await mapLimit(dirs, 24, async (id) => {
    const transcriptFile = join(BRAIN_ROOT, id, '.system_generated', 'logs', 'transcript.jsonl');
    let st;
    try { st = await stat(transcriptFile); } catch { return null; }

    const key = `${META.id}:${id}`;
    const prior = known[key];
    if (!prior && st.size < minBytes) return null;

    const summaryMeta = summaries.get(id);
    if (summaryMeta && (summaryMeta.nestingDepth > 0 || summaryMeta.parentId)) {
      return null;
    }

    let headless = prior?.headless;
    if (headless === undefined) headless = await isHeadlessFile(transcriptFile);

    const cached = !!prior && (prior.ok || prior.empty || prior.headless)
      && (!prior.headless === !headless)
      && prior.bytes === st.size
      && Math.abs((prior.mtime || 0) - st.mtimeMs) <= 1000;

    return {
      key,
      source: META.id,
      id,
      file: transcriptFile,
      bytes: st.size,
      mtimeMs: st.mtimeMs,
      version: 'transcript.jsonl',
      isNew: !prior,
      cached,
      active: isActive(st.mtimeMs),
      headless,
      prior: prior || null,
      metaFallback: summaryMeta || null,
    };
  });
  return rows.filter(Boolean);
}

export async function parseSession(entry) {
  const summaries = loadAgySummaries();
  const sumMeta = summaries.get(entry.id) || entry.metaFallback || {};

  let title = sumMeta.title || '';
  let cwd = sumMeta.cwd || '';
  let turns = 0;
  let firstTime = 0;
  let lastTime = 0;
  const userMsgs = [];
  const assistantTexts = [];
  const toolNames = [];

  await eachJsonLine(entry.file, (j) => {
    const t = toMs(j.created_at || j.timestamp);
    if (t) { if (!firstTime) firstTime = t; lastTime = t; }

    if (j.type === 'USER_INPUT') {
      const text = cleanUserRequest(j.content);
      if (text && !isAutomatedOrHeadlessText(text)) {
        userMsgs.push(text);
      }
    } else if (j.type === 'GENERIC' && j.source === 'MODEL') {
      turns++;
      const text = String(j.content || '').trim();
      if (text) assistantTexts.push(text);
    } else if (j.type === 'PLANNER_RESPONSE') {
      turns++;
      if (Array.isArray(j.tool_calls)) {
        for (const tc of j.tool_calls) {
          if (tc && tc.name) toolNames.push(tc.name);
        }
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
    firstTime: firstTime || (sumMeta.lastModifiedTime ? toMs(sumMeta.lastModifiedTime) : 0),
    lastTime: lastTime || (sumMeta.lastModifiedTime ? toMs(sumMeta.lastModifiedTime) : 0),
    empty: userMsgs.length === 0,
  };
}

export function resumeCommand(rec) {
  return `agy --conversation ${rec.id}`;
}
