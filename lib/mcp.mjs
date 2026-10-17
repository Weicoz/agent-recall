import readline from 'node:readline';
import { readFile } from 'node:fs/promises';
import { searchSessions } from './search.mjs';
import { scanAll, SOURCES } from './harness.mjs';
import { loadState, detailPath } from './store.mjs';
import { VERSION } from './config.mjs';

export function startMcpServer() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  function sendResponse(id, result) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
  }

  function sendError(id, code, message) {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
  }

  const TOOLS = [
    {
      name: 'recall_sessions',
      description: 'Search across all past AI coding sessions (Claude Code, Codex, Antigravity, Kimi Code, DSH) to retrieve prior context, decisions, resume commands, and unfinished task states.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Keywords or natural language search terms' },
          unfinished: { type: 'boolean', description: 'Filter only unfinished, in-progress, or interrupted sessions' },
          status: { type: 'string', enum: ['已完成', '进行中', '中断', '待继续', '仅咨询'], description: 'Optional status filter' },
          project: { type: 'string', description: 'Optional project name filter' },
          source: { type: 'string', enum: ['codex', 'claude', 'agy', 'kimi', 'dsh'], description: 'Optional harness source filter' },
          limit: { type: 'number', description: 'Maximum number of results to return (default 5)' },
        },
      },
    },
    {
      name: 'get_session_detail',
      description: 'Retrieve full details, conversation excerpt, and resume command for a specific session ID.',
      inputSchema: {
        type: 'object',
        properties: {
          sessionId: { type: 'string', description: 'Session ID or Key' },
        },
        required: ['sessionId'],
      },
    },
    {
      name: 'get_harness_status',
      description: 'Get an overview of indexed sessions and pending counts across all supported AI coding harnesses.',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
  ];

  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let req;
    try {
      req = JSON.parse(line);
    } catch {
      return sendError(null, -32700, 'Parse error');
    }

    const { id, method, params } = req;

    if (method === 'initialize') {
      sendResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'agent-recall', version: VERSION },
      });
    } else if (method === 'tools/list') {
      sendResponse(id, { tools: TOOLS });
    } else if (method === 'tools/call') {
      const toolName = params?.name;
      const args = params?.arguments || {};

      try {
        if (toolName === 'recall_sessions') {
          const terms = String(args.query || '').split(/\s+/).filter(Boolean);
          const res = await searchSessions(terms, {
            project: args.project || '',
            source: args.source || '',
            status: args.status || '',
            unfinished: Boolean(args.unfinished),
            limit: Number(args.limit) || 5,
            all: true,
          });
          sendResponse(id, {
            content: [
              {
                type: 'text',
                text: JSON.stringify(res, null, 2),
              },
            ],
          });
        } else if (toolName === 'get_session_detail') {
          const state = await loadState();
          const targetId = args.sessionId;
          let hit = null;
          for (const rec of Object.values(state.sessions || {})) {
            if (rec.id === targetId || rec.key === targetId) {
              hit = rec;
              break;
            }
          }
          if (!hit) {
            sendResponse(id, {
              isError: true,
              content: [{ type: 'text', text: `Session ${targetId} not found.` }],
            });
            return;
          }
          let detailContent = '';
          try {
            const p = detailPath(hit.project, hit.id, hit.time);
            detailContent = await readFile(p, 'utf8');
          } catch {
            detailContent = JSON.stringify(hit, null, 2);
          }
          sendResponse(id, {
            content: [{ type: 'text', text: detailContent }],
          });
        } else if (toolName === 'get_harness_status') {
          const state = await loadState();
          const all = await scanAll({ known: state.sessions });
          const counts = {};
          for (const s of SOURCES) counts[s.META.id] = 0;
          for (const e of all) counts[e.source] = (counts[e.source] || 0) + 1;
          sendResponse(id, {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  totalIndexed: Object.keys(state.sessions || {}).length,
                  harnessCounts: counts,
                  updatedAt: state.updatedAt,
                }, null, 2),
              },
            ],
          });
        } else {
          sendError(id, -32601, `Method ${toolName} not found`);
        }
      } catch (err) {
        sendResponse(id, {
          isError: true,
          content: [{ type: 'text', text: `Error: ${err.message}` }],
        });
      }
    } else {
      sendError(id, -32601, `Unknown method ${method}`);
    }
  });
}
