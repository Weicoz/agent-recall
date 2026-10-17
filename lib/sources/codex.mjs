import { readdir, stat, open } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';

import { mapLimit, projectKey, projectLabel, isActive } from '../session-source.mjs';
import { eachJsonLine, countBy, clipTitle, toMs, isAutomatedOrHeadlessText } from '../parse.mjs';

async function readHeadBytes(file, maxBytes = 8192) {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(maxBytes);
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
    return buf.subarray(0, bytesRead).toString('utf8');
  } catch { return ''; } finally { await fh.close(); }
}

export async function isHeadlessFile(file) {
  let isHeadless = false;
  await eachJsonLine(file, (j) => {
    if (j.type === 'session_meta') {
      const orig = j.payload?.originator;
      if (orig === 'codex_exec' || orig === 'subagent') {
        isHeadless = true;
        return false;
      }
    } else if (j.type === 'response_item') {
      const p = j.payload || {};
      if (p.type === 'message' && p.role === 'user') {
        const text = (p.content || []).map((c) => c?.text || '').join('\n');
        if (!isInjectedUserText(text)) {
          if (isAutomatedOrHeadlessText(text)) {
            isHeadless = true;
          }
          return false;
        }
      }
    }
  }, 1000000);
  return isHeadless;
}

export const META = { id: 'codex', label: 'Codex' };

export const CODEX_ROOT = process.env.AGENT_RECALL_CODEX_ROOT
  || process.env.SESSION_RECALL_CODEX_ROOT
  || join(homedir(), '.codex', 'sessions');

export const EMPTY_CODEX_BYTES = Number(process.env.AGENT_RECALL_CODEX_MIN_BYTES ?? 1200);

const ROLLOUT_RE = /^rollout-.*[-_]([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\.jsonl$/;

const INJECT_PREFIXES = [
  '# AGENTS.md instructions for',
  '<environment_context>',
  '<user_instructions>',
  '<send_user_message_question_reply>',
  '<turn_context>',
  '<permissions',
  '<image name=',
  '</image>',
  'You are performing a one-time structur',
];

export function isInjectedUserText(text) {
  const t = String(text || '').trim();
  if (!t) return true;
  return INJECT_PREFIXES.some((p) => t.startsWith(p));
}

export async function scanSessions({ known = {}, minBytes = EMPTY_CODEX_BYTES } = {}) {
  let rel;
  try { rel = await readdir(CODEX_ROOT, { recursive: true }); } catch { return []; }
  const paths = rel.filter((f) => f.endsWith('.jsonl')).map((f) => join(CODEX_ROOT, f));

  const rows = await mapLimit(paths, 24, async (file) => {
    let st;
    try { st = await stat(file); } catch { return null; }
    const name = basename(file);
    const m = ROLLOUT_RE.exec(name);
    const id = m ? m[1] : name.replace(/\.jsonl$/, '');
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
  let meta = null;
  let turns = 0;
  let firstTime = 0;
  let lastTime = 0;
  const userMsgs = [];
  const assistantTexts = [];
  const toolNames = [];

  await eachJsonLine(entry.file, (j) => {
    const t = toMs(j.timestamp);
    if (t) { if (!firstTime) firstTime = t; lastTime = t; }
    switch (j.type) {
      case 'session_meta':
        meta = j.payload || null;
        return;
      case 'turn_context':
        turns++;
        return;
      case 'response_item': break;
      default: return;
    }
    const p = j.payload || {};
    if (p.type === 'message' && p.role === 'user') {
      const text = (p.content || []).map((c) => c?.text || '').join('\n');
      if (!isInjectedUserText(text)) userMsgs.push(text.trim());
    } else if (p.type === 'message' && p.role === 'assistant') {
      const text = (p.content || []).map((c) => c?.text || '').join('\n').trim();
      if (text) assistantTexts.push(text);
    } else if (p.type === 'custom_tool_call' || p.type === 'function_call') {
      toolNames.push(p.name || '');
    }
  });

  const cwd = meta?.cwd || '';
  return {
    meta: {
      sessionId: meta?.session_id || entry.id,
      cwd,
      projectKey: cwd ? projectKey(cwd) : '',
      projectLabel: projectLabel(cwd, META.label),
      originator: meta?.originator || '',
      cliVersion: meta?.cli_version || '',
    },
    title: clipTitle(userMsgs[0] || ''),
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
  const cmd = `codex resume ${rec.id}`;
  return rec.cwd ? `cd ${rec.cwd} && ${cmd}` : cmd;
}
