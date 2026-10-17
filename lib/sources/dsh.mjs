import { join } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';

import {
  SESSIONS_ROOT, EMPTY_SESSION_BYTES, listProjectDirs, listSessionDirs,
  currentSource, sessionDirPath, isActive, zstdDecode, projectLabel, mapLimit,
} from '../session-source.mjs';
import { isAutomatedOrHeadlessText } from '../parse.mjs';

export const META = { id: 'dsh', label: 'DSH' };

let _scheduledIds = null;
export function getScheduledSessionIds() {
  if (_scheduledIds) return _scheduledIds;
  try {
    const p = join(homedir(), '.dsh', 'storages', 'schedule.json');
    if (!existsSync(p)) return new Set();
    const d = JSON.parse(readFileSync(p, 'utf8'));
    _scheduledIds = new Set(Object.values(d?.tables?.tasks || {}).map((t) => t.sessionId).filter(Boolean));
  } catch {
    _scheduledIds = new Set();
  }
  return _scheduledIds;
}

const msgOf = (j) => j.message || j.data?.message || null;

function textOf(content) {
  if (!content) return '';
  return (Array.isArray(content) ? content : [content])
    .filter((c) => c && c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n')
    .trim();
}

export async function isHeadlessFile(file) {
  const text = await zstdDecode(file, 65536);
  if (isAutomatedOrHeadlessText(text)) return true;
  const nl = text.indexOf('\n');
  const first = nl === -1 ? text : text.slice(0, nl);
  let head;
  try { head = JSON.parse(first); } catch { return false; }
  if (!head || head.type !== 'session') return false;
  return head.origin === 'subagent' || Number(head.delegationDepth || 0) > 0;
}

export async function scanSessions({ known = {}, minBytes = EMPTY_SESSION_BYTES } = {}) {
  const scheduledIds = getScheduledSessionIds();
  const projects = await listProjectDirs();
  const out = [];
  for (const projectDir of projects) {
    const dirs = await listSessionDirs(projectDir);
    const rows = await mapLimit(dirs, 24, async (name) => {
      const src = await currentSource(projectDir, name);
      if (!src) return null;
      const key = `${META.id}:${projectDir}/${name}`;
      const prior = known[key];
      if (!prior && src.size < minBytes) return null;
      let headless = prior?.headless;
      if (scheduledIds.has(name)) {
        headless = true;
      } else if (headless === undefined) {
        headless = await isHeadlessFile(src.path);
      }
      const cached = !!prior && (prior.ok || prior.empty || prior.headless)
        && (!prior.headless === !headless)
        && prior.version === src.version
        && prior.bytes === src.size
        && Math.abs((prior.mtime || 0) - src.mtimeMs) <= 1000;
      return {
        key,
        source: META.id,
        id: name,
        file: src.path,
        projectDir,
        bytes: src.size,
        mtimeMs: src.mtimeMs,
        version: src.version,
        isNew: !prior,
        cached,
        active: isActive(src.mtimeMs),
        headless,
        prior: prior || null,
      };
    });
    for (const r of rows) if (r) out.push(r);
  }
  return out;
}

export async function parseSession(entry) {
  const raw = await zstdDecode(entry.file);
  let sessionHead = null;
  const userMsgs = [];
  const assistantTexts = [];
  const toolNames = [];

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.type === 'session') {
      sessionHead = j;
      continue;
    }
    const msg = msgOf(j);
    if (!msg) continue;
    if (msg.role === 'user') {
      const text = textOf(msg.content);
      if (text && !isAutomatedOrHeadlessText(text)) userMsgs.push(text);
    } else if (msg.role === 'assistant') {
      const text = textOf(msg.content);
      if (text) assistantTexts.push(text);
      if (Array.isArray(msg.toolCalls)) {
        for (const tc of msg.toolCalls) {
          if (tc?.name) toolNames.push(tc.name);
        }
      }
    }
  }

  const cwd = sessionHead?.workspacePath || sessionHead?.cwd || '';
  return {
    meta: {
      sessionId: entry.id,
      cwd,
      projectKey: entry.projectDir,
      projectLabel: projectLabel(cwd, entry.projectDir),
    },
    title: sessionHead?.title || '',
    userMsgs,
    assistantTexts,
    tools: toolNames.reduce((acc, name) => {
      acc[name] = (acc[name] || 0) + 1;
      return acc;
    }, {}),
    turns: assistantTexts.length,
    firstTime: sessionHead?.createdAt || entry.mtimeMs,
    lastTime: sessionHead?.updatedAt || entry.mtimeMs,
    empty: userMsgs.length === 0,
  };
}

export function resumeCommand(rec) {
  return `dsh-tui --resume ${rec.id}`;
}
