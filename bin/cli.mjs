#!/usr/bin/env node
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

import { searchSessions, triggerBackgroundDigest } from '../lib/search.mjs';
import { runInteractiveTui } from '../lib/tui.mjs';
import { startMcpServer } from '../lib/mcp.mjs';
import { runDigest } from '../lib/digest.mjs';
import { loadState, detailPath, localTime } from '../lib/store.mjs';
import { scanAll, SOURCES, sourceLabel } from '../lib/harness.mjs';
import { VERSION, resolveLlmConfig, CONFIG_FILE, DATA_DIR } from '../lib/config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const has = (n) => args.includes(n);

if (has('--version') || has('-v')) {
  console.log(`agent-recall (harness-recall) v${VERSION}`);
  process.exit(0);
}

if (has('--help') || has('-h') || (args.length === 1 && args[0] === 'help')) {
  console.log(`
\x1b[1m\x1b[36magent-recall\x1b[0m v${VERSION}
Universal session recall & management CLI for AI coding agents.
Supports: \x1b[32mClaude Code\x1b[0m, \x1b[32mCodex\x1b[0m, \x1b[32mAntigravity\x1b[0m, \x1b[32mKimi Code\x1b[0m, \x1b[32mDSH\x1b[0m.

\x1b[1mUSAGE:\x1b[0m
  recall <keywords...>               Search sessions (current project prioritized)
  recall <keywords...> --all         Search across all projects
  recall <keywords...> -i            Interactive selection mode (TUI)
  recall <keywords...> --detail      Show full detail of top match
  recall <keywords...> --json        Output results in JSON format
  recall <keywords...> --source=codex Filter by harness (codex|claude|agy|kimi|dsh)
  recall <keywords...> --project=foo Filter by project name substring

\x1b[1mMANAGEMENT COMMANDS:\x1b[0m
  recall status                      Show indexed scale & pending counts
  recall digest [--force]            Manually run incremental or full digest
  recall resume <sessionId>          Show or execute resume command for session
  recall mcp                         Start Model Context Protocol (MCP) server
  recall config                      Show current config & data paths
  recall --version, -v               Print version
`);
  process.exit(0);
}

const subCmd = args[0];

if (subCmd === 'mcp') {
  startMcpServer();
} else if (subCmd === 'config') {
  const cfg = resolveLlmConfig();
  console.log('\x1b[1m\x1b[36m=== Agent Recall Configuration ===\x1b[0m');
  console.log(`- Config File:  ${CONFIG_FILE}`);
  console.log(`- Data Directory: ${DATA_DIR}`);
  console.log(`- Zero-LLM Mode: ${cfg.zeroLlm ? '\x1b[32mEnabled (Local deterministic, zero API cost)\x1b[0m' : '\x1b[33mDisabled (Using remote LLM)\x1b[0m'}`);
  if (!cfg.zeroLlm) {
    console.log(`- LLM Base URL: ${cfg.baseUrl}`);
    console.log(`- LLM Model:    ${cfg.model}`);
    console.log(`- LLM Protocol: ${cfg.protocol}`);
  }
  process.exit(0);
} else if (subCmd === 'digest') {
  const isForce = has('--force');
  const isDry = has('--dry');
  const limit = Number(args.find((a) => a.startsWith('--limit='))?.split('=')[1] || 0);
  await runDigest({ force: isForce, dry: isDry, limit });
  process.exit(0);
} else if (subCmd === 'resume') {
  const targetId = args[1];
  if (!targetId) {
    console.error('Error: Please provide a session ID (e.g. recall resume <id>)');
    process.exit(1);
  }
  const state = await loadState();
  let hit = null;
  for (const r of Object.values(state.sessions || {})) {
    if (r.id === targetId || r.key === targetId || r.key.endsWith(`:${targetId}`)) {
      hit = r;
      break;
    }
  }
  if (!hit) {
    console.error(`Session ${targetId} not found in index.`);
    process.exit(1);
  }
  const cmd = (await import('../lib/harness.mjs')).resumeCommand(hit);
  console.log(`\x1b[32m[${sourceLabel(hit.source)}] \x1b[1m${hit.title}\x1b[0m`);
  console.log(`Resume Command:\n\x1b[36m${cmd}\x1b[0m`);
  process.exit(0);
} else if (subCmd === 'status' || has('--status')) {
  const state = await loadState();
  const all = await scanAll({ known: state.sessions });
  const counts = {};
  for (const s of SOURCES) counts[s.META.id] = 0;
  for (const e of all) counts[e.source] = (counts[e.source] || 0) + 1;

  const indexedCount = Object.keys(state.sessions || {}).length;
  const pendingCount = all.filter((e) => !e.cached && !e.headless).length;

  console.log('\x1b[1m\x1b[36m=== Agent Recall Status ===\x1b[0m');
  console.log(`- Total Indexed Sessions: \x1b[1m${indexedCount}\x1b[0m`);
  console.log(`- Pending Digest Needed:  \x1b[1m${pendingCount}\x1b[0m`);
  console.log(`- Discovered on Disk:     \x1b[1m${all.length}\x1b[0m`);
  console.log('\n\x1b[1mBy Harness Breakdown:\x1b[0m');
  for (const s of SOURCES) {
    const id = s.META.id;
    const inDb = Object.values(state.sessions || {}).filter((r) => r.source === id).length;
    console.log(`  • \x1b[33m${s.META.label.padEnd(14)}\x1b[0m Disk: ${String(counts[id] || 0).padStart(4)} | Indexed: ${String(inDb).padStart(4)}`);
  }
  process.exit(0);
} else {
  // Query mode
  const kvOpt = (n) => {
    const p = args.find((a) => a.startsWith(`--${n}=`));
    return p ? p.slice(n.length + 3) : '';
  };
  const terms = args.filter((a) => !a.startsWith('-')).map((t) => t.toLowerCase());
  const wantJson = has('--json');
  const wantDetail = has('--detail');
  const wantInteractive = has('-i') || has('--interactive');
  const wantAll = has('--all');
  const limit = Number(kvOpt('limit')) || 5;
  const project = kvOpt('project');
  const source = kvOpt('source');

  const { results, matchedCount, isCurrentProjectOnly } = await searchSessions(terms, {
    project,
    source,
    limit,
    all: wantAll,
  });

  // Non-blocking trigger of silent background digest
  if (!has('--no-collect')) {
    await triggerBackgroundDigest(HERE);
  }

  if (wantJson) {
    console.log(JSON.stringify(results, null, 2));
    process.exit(0);
  }

  if (wantInteractive) {
    runInteractiveTui(results);
    // TUI controls process exit
  } else {
    if (results.length === 0) {
      console.log('未找到匹配的历史会话。可以尝试使用更宽泛的关键词或添加 --all 参数。');
      process.exit(0);
    }

    if (wantDetail && results.length > 0) {
      const top = results[0];
      try {
        const p = detailPath(top.project, top.id, top.time);
        console.log(await readFile(p, 'utf8'));
      } catch {
        console.log(`# ${top.title}\n\n${top.summary}`);
      }
      process.exit(0);
    }

    console.log(`\x1b[90m共匹配 ${matchedCount} 条会话${isCurrentProjectOnly ? ' (当前项目优先，使用 --all 跨全项目)' : ''}：\x1b[0m\n`);

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const tag = i === 0 ? '\x1b[32m[最佳匹配]\x1b[0m ' : '';
      console.log(`${tag}\x1b[1m#${i + 1} [${r.sourceLabel}] [${r.projectLabel || r.project}] ${r.title}\x1b[0m`);
      console.log(`   \x1b[90m时间: ${localTime(r.time)} | 命中: ${r.matchedFields.join(', ')}\x1b[0m`);
      console.log(`   \x1b[33m摘要: \x1b[0m${r.summary}`);
      if (r.resume) {
        console.log(`   \x1b[36m回到会话: \x1b[0m\x1b[4m${r.resume}\x1b[0m`);
      }
      console.log('');
    }
  }
}
