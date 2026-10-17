import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

export const VERSION = '1.0.0';

export const HOME = homedir();

export const CONFIG_DIR = process.env.AGENT_RECALL_CONFIG_DIR
  || join(HOME, '.config', 'agent-recall');

export const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

// Default data directory: ~/.local/state/agent-recall
// Fallback / legacy compatibility with ~/.local/state/weicoz-session-recall
const DEFAULT_DATA_DIR = join(HOME, '.local', 'state', 'agent-recall');
const LEGACY_DATA_DIR = join(HOME, '.local', 'state', 'weicoz-session-recall');

export function resolveDataDir() {
  if (process.env.AGENT_RECALL_DATA_DIR) {
    return process.env.AGENT_RECALL_DATA_DIR;
  }
  if (process.env.SESSION_RECALL_DATA_DIR) {
    return process.env.SESSION_RECALL_DATA_DIR;
  }
  if (!existsSync(DEFAULT_DATA_DIR) && existsSync(LEGACY_DATA_DIR)) {
    return LEGACY_DATA_DIR;
  }
  return DEFAULT_DATA_DIR;
}

export const DATA_DIR = resolveDataDir();

export function loadUserConfig() {
  if (existsSync(CONFIG_FILE)) {
    try {
      return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
    } catch {}
  }
  return {};
}

/**
 * Resolve API configuration for digest generation.
 * Supports OpenAI-compatible endpoints, Ollama, DeepSeek, or Zero-LLM mode.
 */
export function resolveLlmConfig() {
  const cfg = loadUserConfig();
  const llm = cfg.llm || {};

  const apiKey = (
    process.env.AGENT_RECALL_API_KEY ||
    process.env.OPENAI_API_KEY ||
    process.env.SESSION_RECALL_API_KEY ||
    llm.apiKey ||
    ''
  ).trim();

  let baseUrl = (
    process.env.AGENT_RECALL_API_URL ||
    process.env.AGENT_RECALL_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    process.env.OPENAI_API_BASE ||
    process.env.SESSION_RECALL_API_URL ||
    llm.baseUrl ||
    ''
  ).trim();

  let protocol = (
    process.env.AGENT_RECALL_PROTOCOL ||
    process.env.SESSION_RECALL_PROTOCOL ||
    llm.protocol ||
    ''
  ).toLowerCase().trim();

  let model = (
    process.env.AGENT_RECALL_MODEL ||
    process.env.OPENAI_MODEL ||
    llm.model ||
    ''
  ).trim();

  // If no API key is found, inspect common host configs
  let hostApiKey = '';
  if (!apiKey) {
    try {
      const ocPath = join(HOME, '.opencodex', 'config.json');
      if (existsSync(ocPath)) {
        const oc = JSON.parse(readFileSync(ocPath, 'utf8'));
        const prov = oc?.providers?.newapi || oc?.providers?.deepseek || oc?.providers?.openai;
        if (prov) {
          hostApiKey = prov.apiKey || '';
          if (!baseUrl) baseUrl = prov.baseUrl || '';
        }
      }
    } catch {}
  }

  const effectiveKey = apiKey || hostApiKey;

  if (!protocol) {
    if (baseUrl.includes('/responses')) {
      protocol = 'respond';
    } else {
      protocol = 'chat';
    }
  }

  if (!baseUrl) {
    if (protocol === 'respond') {
      baseUrl = 'https://api.openai.com/v1';
    } else {
      baseUrl = 'https://api.deepseek.com/v1';
    }
  }

  const trimmed = baseUrl.replace(/\/+$/, '');
  let endpoint = trimmed;
  if (protocol === 'respond') {
    endpoint = trimmed.endsWith('/responses') ? trimmed : `${trimmed}/responses`;
  } else {
    endpoint = trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`;
  }

  if (!model) {
    model = 'deepseek-chat';
  }

  return {
    hasKey: Boolean(effectiveKey),
    apiKey: effectiveKey,
    baseUrl: trimmed,
    endpoint,
    protocol,
    model,
    // When enabled, bypasses LLM network calls entirely and uses deterministic local metadata
    zeroLlm: !effectiveKey || cfg.zeroLlm === true || process.env.AGENT_RECALL_ZERO_LLM === '1',
  };
}
