import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { DATA_DIR } from './config.mjs';
import { projectLabel } from './session-source.mjs';
import { resumeCommand, sourceLabel } from './harness.mjs';

export { DATA_DIR };

export const STATE_FILE = join(DATA_DIR, 'state.json');
export const PROJECTS_FILE = join(DATA_DIR, 'projects.json');
export const INDEX_FILE = join(DATA_DIR, 'index.md');
export const DETAIL_DIR = join(DATA_DIR, 'detail');
export const LOCK_FILE = join(DATA_DIR, 'lock');

export const localTime = (ms) => {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const dayOf = (ms) => (ms ? localTime(ms).slice(0, 10) : '0000-00-00');

export const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n+/g, ' ').trim() || '—';

export function detailPath(projectDir, id, ms) {
  return join(DETAIL_DIR, projectDir, `${dayOf(ms)}-${id}.md`);
}

export function detailLink(projectDir, id, ms) {
  return encodeURI(`detail/${projectDir}/${dayOf(ms)}-${id}.md`);
}

export async function readJson(file, dflt = null) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return dflt; }
}

export async function writeAtomic(file, content) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, content, 'utf8');
  await rename(tmp, file);
}

export async function loadState() {
  return (await readJson(STATE_FILE, null)) || { updatedAt: 0, models: [], sessions: {} };
}

export async function loadProjects() {
  return (await readJson(PROJECTS_FILE, null)) || {};
}

export function touchProject(projects, projectDir, cwd) {
  const prev = projects[projectDir] || {};
  const next = {
    cwd: cwd || prev.cwd || '',
    label: projectLabel(cwd, prev.label || projectDir),
    seen: Date.now(),
  };
  projects[projectDir] = next;
  return next;
}

export function projectTitle(projects, projectDir) {
  const p = projects[projectDir];
  return (p && p.label) || projectDir;
}

// ---------- Lock Management ----------

export async function acquireLock() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const handle = await open(LOCK_FILE, 'wx');
    await handle.writeFile(JSON.stringify({ pid: process.pid, time: Date.now() }), 'utf8');
    await handle.close();
    return true;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    try {
      const info = JSON.parse(await readFile(LOCK_FILE, 'utf8'));
      if (Date.now() - info.time > 1800_000) { // Stale lock > 30min
        await unlink(LOCK_FILE).catch(() => {});
        return acquireLock();
      }
      try {
        process.kill(info.pid, 0); // Check if process is alive
        return false;
      } catch {
        await unlink(LOCK_FILE).catch(() => {});
        return acquireLock();
      }
    } catch {
      await unlink(LOCK_FILE).catch(() => {});
      return acquireLock();
    }
  }
}

export async function releaseLock() {
  await unlink(LOCK_FILE).catch(() => {});
}

export async function isLockActive() {
  try {
    const text = await readFile(LOCK_FILE, 'utf8');
    const info = JSON.parse(text);
    if (!info?.pid) return false;
    if (Date.now() - info.time > 1800_000) return false;
    process.kill(info.pid, 0);
    return true;
  } catch {
    return false;
  }
}

// ---------- Markdown Rendering ----------

export function renderDetail(rec) {
  const L = [];
  L.push(`# ${rec.title || '（无标题会话）'}`);
  L.push('');
  L.push(`- 来源：${sourceLabel(rec.source || rec.key)}`);
  L.push(`- 项目：${rec.projectLabel || rec.project || '—'}`);
  L.push(`- 会话 ID：\`${rec.id}\``);
  if (rec.cwd) L.push(`- 工作区：\`${rec.cwd}\``);
  L.push(`- 时间：${localTime(rec.time)}`);
  if (rec.status) L.push(`- 状态：${rec.status}`);
  if (rec.keywords && rec.keywords.length) L.push(`- 关键词：${rec.keywords.map((k) => `\`${k}\``).join(' ')}`);
  if (rec.tools && Object.keys(rec.tools).length) {
    const t = Object.entries(rec.tools).map(([k, v]) => `${k}×${v}`).join(', ');
    L.push(`- 调用的工具：${t}`);
  }
  const resume = resumeCommand(rec);
  if (resume) {
    L.push('');
    L.push('## 回到原会话');
    L.push('');
    L.push('```bash');
    L.push(resume);
    L.push('```');
  }

  L.push('');
  L.push('## 摘要');
  L.push('');
  L.push(rec.summary || '（暂无摘要）');

  if (rec.artifacts && rec.artifacts.length) {
    L.push('');
    L.push('## 产出物 / 交付物');
    L.push('');
    for (const a of rec.artifacts) L.push(`- \`${a}\``);
  }

  if (rec.userTexts && rec.userTexts.length) {
    L.push('');
    L.push('## 用户发言（节选）');
    L.push('');
    for (const [i, m] of rec.userTexts.slice(0, 10).entries()) {
      L.push(`### #${i + 1}`);
      L.push('');
      L.push(m.length > 500 ? `${m.slice(0, 500)}…` : m);
      L.push('');
    }
  }

  L.push('');
  L.push('---');
  L.push(`*由 [agent-recall](https://github.com/Weicoz/agent-recall) 自动索引于 ${localTime(Date.now())}*`);
  L.push('');
  return L.join('\n');
}

export function renderIndex(records, projects) {
  const L = [];
  L.push('# AI Agent 历史会话索引');
  L.push('');
  L.push(`> 集中索引本地所有 AI Harness（Claude Code / Codex / Antigravity / Kimi Code / DSH）历史会话。`);
  L.push(`> 最后更新：${localTime(Date.now())} · 共 ${Object.keys(records).length} 个会话`);
  L.push('');

  const list = Object.values(records)
    .filter((r) => r.ok && !r.empty && !r.headless)
    .sort((a, b) => (b.time || 0) - (a.time || 0));

  L.push('## 最近活动（前 30 条）');
  L.push('');
  L.push('| 时间 | 来源 | 项目 | 标题 | 摘要 | 状态 |');
  L.push('| --- | --- | --- | --- | --- | --- |');
  for (const r of list.slice(0, 30)) {
    const link = `[${esc(r.title || r.id)}](${detailLink(r.project, r.id, r.time)})`;
    L.push(`| ${dayOf(r.time)} | ${esc(sourceLabel(r.source))} | ${esc(r.projectLabel || r.project)} | ${link} | ${esc(r.summary)} | ${esc(r.status)} |`);
  }
  L.push('');

  return L.join('\n');
}
