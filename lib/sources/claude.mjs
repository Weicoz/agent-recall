import { readdir, stat, open } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

import { mapLimit, projectKey, projectLabel, isActive } from '../session-source.mjs';
import { eachJsonLine, countBy, clipTitle, toMs, isAutomatedOrHeadlessText } from '../parse.mjs';

async function readHeadBytes(file, maxBytes = 65536) {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } catch { return ''; } finally { await fh.close(); }
}

export async function isHeadlessFile(file) {
  const head = await readHeadBytes(file);
  if (isAutomatedOrHeadlessText(head)) return true;
  for (const line of head.split('\n')) {
    if (!line.trim()) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.type === 'user' && j.message) {
      if (j.promptSource || j.entrypoint) {
        if (j.promptSource === 'sdk' || j.promptSource === 'system' || j.entrypoint === 'sdk-cli') return true;
      }
      const text = typeof j.message === 'string' ? j.message : (j.message.content || '');
      if (isAutomatedOrHeadlessText(typeof text === 'string' ? text : JSON.stringify(text))) return true;
      return false;
    }
  }
  return false;
}

export const META = { id: 'claude', label: 'Claude Code' };

export const CLAUDE_ROOT = process.env.AGENT_RECALL_CLAUDE_ROOT
  || process.env.SESSION_RECALL_CLAUDE_ROOT
  || join(homedir(), '.claude', 'projects');

export const EMPTY_CLAUDE_BYTES = Number(process.env.AGENT_RECALL_CLAUDE_MIN_BYTES ?? 1200);

const INJECT_PREFIXES = [
  'Base directory for this skill:',
  '<local-command-caveat>',
  '<local-command-stdout>',
  '<command-message>',
  '<command-name>',
  '<system-reminder>',
  'Another Claude session sent a mess',
  'This session is being continued fr',
  '[Image: source:',
  '[Request interrupted by user',
];

const SLASH_CMD_RE = /^\/[a-z][a-z-]*$/i;

function isInjected(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  if (SLASH_CMD_RE.test(t)) return true;
  return INJECT_PREFIXES.some((p) => t.startsWith(p));
}

function userText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  if (content.some((c) => c?.type === 'tool_result')) return '';
  return content.filter((c) => c?.type === 'text').map((c) => c.text || '').join('\n');
}

function assistantText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((c) => c?.type === 'text').map((c) => c.text || '').join('\n');
}

export async function scanSessions({ known = {}, minBytes = EMPTY_CLAUDE_BYTES } = {}) {
  let projectDirs;
  try { projectDirs = await readdir(CLAUDE_ROOT); } catch { return []; }

  const files = [];
  for (const p of projectDirs) {
    const dir = join(CLAUDE_ROOT, p);
    let sub;
    try { sub = await readdir(dir); } catch { continue; }
    for (const f of sub) {
      if (f.endsWith('.jsonl')) files.push({ projectDir: p, file: join(dir, f) });
    }
  }

  const rows = await mapLimit(files, 24, async ({ projectDir, file }) => {
    let st;
    try { st = await stat(file); } catch { return null; }
    const name = basename(file);
    const id = name.replace(/\.jsonl$/, '');
    const key = `${META.id}:${id}`;
    const prior = known[key];
    if (!prior && st.size < minBytes) return null;
    let headless = prior?.headless;
    if (headless === undefined) headless = await isHeadlessFile(file);
    const cached = !!prior && (prior.ok || prior.empty || prior.headless)
      && (!prior.headless === !headless)
      && prior.bytes === st.size
      && Math.abs((prior.mtime || 0) - st.mtimeMs) <= 1000;
    return {
      key,
      source: META.id,
      id,
      file,
      bytes: st.size,
      mtimeMs: st.mtimeMs,
      version: 'jsonl',
      projectDir,
      isNew: !prior,
      cached,
      active: isActive(st.mtimeMs),
      headless,
      prior: prior || null,
    };
  });
  return rows.filter(Boolean);
}

export async function parseSession(entry) {
  let title = '';
  let cwd = '';
  let turns = 0;
  let firstTime = 0;
  let lastTime = 0;
  const userMsgs = [];
  const assistantTexts = [];
  const toolNames = [];

  await eachJsonLine(entry.file, (j) => {
    const t = toMs(j.timestamp);
    if (t) { if (!firstTime) firstTime = t; lastTime = t; }
    if (j.cwd && !cwd) cwd = j.cwd;

    switch (j.type) {
      case 'custom-title':
        if (j.title && !title) title = String(j.title).trim();
        return;
      case 'user': {
        if (j.isSidechain) return;
        const raw = userText(j.message?.content);
        if (!isInjected(raw)) userMsgs.push(raw.trim());
        return;
      }
      case 'assistant': {
        if (j.isSidechain) return;
        turns++;
        const content = j.message?.content;
        if (Array.isArray(content)) {
          for (const c of content) {
            if (c?.type === 'tool_use' && c.name) toolNames.push(c.name);
          }
        }
        const text = assistantText(content).trim();
        if (text) assistantTexts.push(text);
        return;
      }
    }
  });

  if (!title) title = clipTitle(userMsgs[0] || '');

  return {
    meta: {
      sessionId: entry.id,
      cwd,
      projectKey: cwd ? projectKey(cwd) : entry.projectDir || '',
      projectLabel: projectLabel(cwd, entry.projectDir || META.label),
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
  const cmd = `claude --resume ${rec.id}`;
  return rec.cwd ? `cd ${rec.cwd} && ${cmd}` : cmd;
}
