import { readdir, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';

export const SESSIONS_ROOT = process.env.AGENT_RECALL_DSH_ROOT
  || process.env.SESSION_RECALL_SESSIONS_ROOT
  || join(homedir(), '.dsh', 'sessions');

export const VERSION_ORDER = [
  'session.v4.jsonl.zstd',
  'session.v3.jsonl.zstd',
  'session.v2.jsonl.zstd',
  'session.jsonl.zstd',
];

export const EMPTY_SESSION_BYTES = 4000;

const SEPARATORS = '/\\:';
const SAFE = /[A-Za-z0-9._-]/;

/**
 * Convert working directory path into standardized project key.
 * Compatible with DSH session projectKey format.
 */
export function projectKey(cwd) {
  let out = '';
  let pendingSep = false;
  for (let i = 0; i < cwd.length; i++) {
    const ch = cwd[i];
    if (SEPARATORS.includes(ch)) { pendingSep = true; continue; }
    if (pendingSep) { out += '-'; pendingSep = false; }
    out += (ch !== '~' && SAFE.test(ch))
      ? ch
      : `~${cwd.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')}`;
  }
  return `--${(out.replace(/^-+/, '') || 'root').slice(0, 251)}--`;
}

/** Human-readable project label (basename of cwd or directory name). */
export function projectLabel(cwd, fallback = '') {
  if (!cwd) return fallback;
  return basename(cwd) || cwd;
}

export function currentProjectKey(cwd = process.cwd()) {
  return projectKey(cwd);
}

export async function listProjectDirs() {
  try {
    const entries = await readdir(SESSIONS_ROOT, { withFileTypes: true });
    return entries.filter((d) => d.isDirectory()).map((d) => d.name);
  } catch { return []; }
}

export async function listSessionDirs(projectDir) {
  try {
    const entries = await readdir(join(SESSIONS_ROOT, projectDir), { withFileTypes: true });
    return entries.filter((d) => d.isDirectory()).map((d) => d.name);
  } catch { return []; }
}

export function sessionDirPath(projectDir, sessionDir) {
  return join(SESSIONS_ROOT, projectDir, sessionDir);
}

export async function currentSource(projectDir, sessionDir) {
  for (const version of VERSION_ORDER) {
    const path = join(SESSIONS_ROOT, projectDir, sessionDir, version);
    try {
      const st = await stat(path);
      return { version, path, size: st.size, mtimeMs: st.mtimeMs };
    } catch {}
  }
  return null;
}

export function isChanged(rec, src) {
  if (!rec || !src) return true;
  if (rec.version !== src.version) return true;
  if (rec.bytes !== src.size) return true;
  if (Math.abs((rec.mtime || 0) - src.mtimeMs) > 1000) return true;
  return false;
}

export const ACTIVE_WINDOW_MS = 20_000;
export const isActive = (mtimeMs, now = Date.now()) => now - mtimeMs < ACTIVE_WINDOW_MS;

export async function mapLimit(items, limit, fn) {
  const ret = new Array(items.length);
  let idx = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (idx < items.length) {
      const cur = idx++;
      ret[cur] = await fn(items[cur], cur);
    }
  });
  await Promise.all(workers);
  return ret;
}

/** Decompress zstd compressed file or prefix up to maxBytes. */
export function zstdDecode(file, maxBytes = 0) {
  return new Promise((resolve) => {
    const p = spawn('zstd', ['-d', '-c', '-q', file]);
    const chunks = [];
    let bytes = 0;
    p.stdout.on('data', (c) => {
      chunks.push(c);
      bytes += c.length;
      if (maxBytes && bytes >= maxBytes) {
        p.kill('SIGTERM');
      }
    });
    p.on('error', () => resolve(''));
    p.on('close', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}
