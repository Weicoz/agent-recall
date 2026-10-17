---
name: session-recall
version: 1.0.0
description: Universal session recall & management across 5 major AI coding harnesses (Claude Code, OpenAI Codex CLI, Google Antigravity, Kimi Code, DSH). Retrieves past session summaries, architectural decisions, and artifact deliverables. Answers "what did we do before regarding X?" and provides instant resume commands.
whenToUse: When looking for past coding sessions, reviewing architectural decisions, tracking previous deliverables, or resuming prior conversation contexts.
---

# Universal Session Recall (agent-recall / harness-recall)

Unified semantic history & resume command generator for AI coding agents across **Claude Code**, **OpenAI Codex CLI**, **Google Antigravity**, **Kimi Code**, and **DSH**.

## Prerequisites

Ensure `agent-recall` is installed:
```bash
# Install globally via npm (recommended)
npm install -g harness-recall

# Or test via npx
npx harness-recall --version
```

## How It Works

All sessions are indexed locally (in `~/.local/state/agent-recall/` or `~/.local/state/weicoz-session-recall/`) by their working directory (`cwd`). Regardless of which AI harness you are currently using, you can search history across all 5 tools simultaneously.

| Harness | Storage Source | Instant Resume Command |
| --- | --- | --- |
| **Claude Code** | `~/.claude/projects/<project>/*.jsonl` | `cd <cwd> && claude --resume <sessionId>` |
| **OpenAI Codex** | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | `cd <cwd> && codex resume <sessionId>` |
| **Antigravity** | `~/.gemini/antigravity-cli/brain/<uuid>/...` | `agy --conversation <sessionId>` |
| **Kimi Code** | `~/.kimi-code/sessions/wd_<hash>/session_<uuid>/...` | `cd <cwd> && kimi --session <sessionId>` |
| **DSH** | `~/.dsh/sessions/<project>/<session>/` | `dsh-tui --resume <sessionId>` |

---

## Agent Execution Pipeline (Strict 3-Stage Discipline)

When the user asks to recall or find past sessions (e.g. `/session-recall <query>` or "find past discussions about X"):

### Stage 1: Query Understanding & Keyword Extraction
- Extract **2 to 4 distinctive, high-signal search terms** (Project Name > Feature/Module > Key Tech/File > Core Action).
- **NEVER** pass an entire conversational sentence verbatim to the search engine.
- *Examples*:
  - "Find the session where we debugged redis deadlocks in payment module" → `redis deadlock payment`
  - "Last week's auction countdown component" → `auction countdown component`

### Stage 2: Programmatic Retrieval
Execute candidate search via the CLI (fetches top 5–10 candidates):
```bash
# Standard search
recall <extracted_keywords...> --limit=10 [--all] [--json]

# Filter unfinished / in-progress / interrupted sessions
recall unfinished [keywords...]
recall <keywords...> --unfinished

# Filter by specific status
recall <keywords...> --status=<已完成|进行中|中断|待继续|仅咨询>
```
- By default, searches prioritize the current project working directory, falling back globally.
- Use `--all` to force global search across all projects.
- Use `--source=<codex|claude|agy|kimi|dsh>` to filter by tool.
- Every result includes status (`status`, `isUnfinished`, `statusReason`) and timestamps (`lastTimeFormatted`, `relativeTime`).

### Stage 3: LLM Relevance Reranking & Presentation
Compare recalled candidates against the user's original request:
1. **Best Match First**: Mark `#1 (Recommended / Best Fit)` with a 1-sentence rationale explaining why it best matches the query.
2. **Status & Time**: Always display the status badge `[已完成 | 进行中 | 中断 | 待继续]` and last activity timestamp.
3. **Subsequent Candidates**: List in descending order of relevance.
4. **Resume Hook**: Always include the exact resume command displayed in the result (`回到会话 / Resume: ...`).

---

## CLI Command Quick Reference

```bash
recall "authentication jwt"           # Search current project, fall back globally
recall "auction" --all                # Force search across all projects
recall unfinished                     # List all unfinished, in-progress, or interrupted sessions
recall "payment" --unfinished         # Search only among unfinished payment sessions
recall --status=进行中                 # Filter specifically for in-progress sessions
recall "refactor" --source=claude     # Filter by specific harness
recall "payment" --project=my-saas    # Filter by project directory name
recall "migration" --detail           # Display full transcript detail for top match
recall status                         # Check discovery and index counts
recall digest                         # Manually trigger background digest
```
