import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export const READ_LIMIT_CHARS = Number(process.env.AGENT_RECALL_READ_LIMIT ?? 40_000_000);

/**
 * Stream JSONL line by line and call onLine for each valid object.
 * Returning false from onLine halts processing early.
 */
export async function eachJsonLine(file, onLine, maxChars = READ_LIMIT_CHARS) {
  const stream = createReadStream(file, { encoding: 'utf8' });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let chars = 0;
  let stopped = false;
  try {
    for await (const line of rl) {
      chars += line.length + 1;
      if (chars > maxChars) break;
      if (line.charCodeAt(0) !== 0x7b /* { */) continue;
      let j;
      try { j = JSON.parse(line); } catch { continue; }
      if (onLine(j) === false) { stopped = true; break; }
    }
  } finally {
    rl.close();
    stream.destroy();
  }
  return { chars, stopped };
}

/** Count frequencies of tool names. */
export function countBy(names) {
  const m = {};
  for (const name of names) {
    if (!name) continue;
    m[name] = (m[name] || 0) + 1;
  }
  return m;
}

/** Collapse text into single line snippet with max length. */
export function clipTitle(text, max = 56) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** Safe timestamp conversion to milliseconds. */
export function toMs(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

/** Common patterns that distinguish headless/automated/probe sessions. */
export const AUTOMATED_OR_HEADLESS_PATTERNS = [
  'Automation:',
  'Automation ID:',
  '定时任务：',
  '定时任务:',
  '自动化任务：',
  '自动化任务:',
  '[定时任务]',
  '[自动化任务]',
  'probe.txt',
  '_probe.txt',
  '健康探测',
  '健康检查',
  '创建探测文件',
  'KIMI_NEWAPI_HEADROOM_OK',
  'modlens-work',
  '只回复 OK',
  'You are a search evidence engine',
  'search evidence engine',
  'You are a subagent',
  '你是一个子代理',
  '子代理任务',
  'agent-swarm',
  'You are a delegated agent',
];

export function isAutomatedOrHeadlessText(text) {
  if (!text || typeof text !== 'string') return false;
  for (const pattern of AUTOMATED_OR_HEADLESS_PATTERNS) {
    if (text.includes(pattern)) return true;
  }
  return false;
}
