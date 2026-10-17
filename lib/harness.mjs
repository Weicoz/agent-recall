import * as dsh from './sources/dsh.mjs';
import * as codex from './sources/codex.mjs';
import * as claude from './sources/claude.mjs';
import * as agy from './sources/agy.mjs';
import * as kimi from './sources/kimi.mjs';

export const SOURCES = [dsh, codex, claude, agy, kimi];

const BY_ID = new Map(SOURCES.map((s) => [s.META.id, s]));

export function sourceById(id) {
  return BY_ID.get(String(id || '')) || dsh;
}

export function sourceOfKey(key) {
  return sourceById(String(key || '').split(':')[0]);
}

export function sourceLabel(idOrKey) {
  const raw = String(idOrKey || '');
  const id = raw.includes(':') ? raw.split(':')[0] : raw;
  return sourceById(id).META.label;
}

export function migrateLegacyState(state) {
  if (!state?.sessions) return 0;
  let moved = 0;
  for (const [key, rec] of Object.entries(state.sessions)) {
    if (key.includes(':') || !rec || typeof rec !== 'object') continue;
    const next = `${dsh.META.id}:${key}`;
    state.sessions[next] = { ...rec, key: next, source: dsh.META.id };
    delete state.sessions[key];
    moved++;
  }
  return moved;
}

export async function scanAll({ known = {}, only = null } = {}) {
  const picked = only ? [sourceById(only)] : SOURCES;
  const results = await Promise.all(picked.map((s) => s.scanSessions({ known }).catch(() => [])));
  return results.flat();
}

export async function parseEntry(entry) {
  return sourceOfKey(entry.key).parseSession(entry);
}

export function resumeCommand(rec) {
  return sourceOfKey(rec.key).resumeCommand(rec);
}
