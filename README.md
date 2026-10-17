# 🧠 agent-recall (harness-recall)

> **Universal session recall & management CLI for AI coding agents.**  
> Never lose track of what your AI coding assistant did yesterday. Local-first, cross-harness semantic history & instant session resumption.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js CI](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/Weicoz/agent-recall/pulls)

[English](#english) | [中文说明](#chinese)

---

<a name="english"></a>
## 💡 Why agent-recall?

Developers today rarely use just one AI coding tool. You might use **Claude Code** for large refactors, **OpenAI Codex CLI** for quick fixes, **Google Antigravity** for complex agentic workflows, **Kimi Code** for long-context analysis, and **DSH** for specialized tasks.

**The Problem:**
- Each tool stores conversation history in completely incompatible formats (`.jsonl`, `.zstd`, SQLite, custom directories).
- You frequently ask yourself: *"Which agent did I use to build that auction module last week?"*, *"What were the exact architectural decisions made in that session?"*, *"How do I jump back into that conversation right now?"*
- Existing session recall solutions are usually bound as agent "skills" inside a specific harness, consuming context tokens and forcing you to launch an agent just to remember what another agent did.

**The Solution:**
`agent-recall` is a **standalone terminal CLI and Model Context Protocol (MCP) server** that unifies all your local AI coding sessions under one roof.

---

## ✨ Features

- 🌐 **5 Major AI Harnesses Supported Out-of-the-Box**:
  - **Claude Code** (`~/.claude/projects/`)
  - **OpenAI Codex CLI** (`~/.codex/sessions/`)
  - **Google Antigravity** (`~/.gemini/antigravity-cli/brain/`)
  - **Kimi Code** (`~/.kimi-code/sessions/`)
  - **DSH (DeepSeek Harness)** (`~/.dsh/sessions/`)
- 📁 **Automatic Project-Centric Merging**: Automatically normalizes sessions by their working directory (`cwd`). Search for a project and see all sessions across all tools in one unified timeline.
- ⚡ **Zero-LLM Local Mode**: Works 100% out-of-the-box with **zero API keys and zero cost**. Generates deterministic keywords, artifacts, and summary cards in under 1ms.
- 🤖 **Optional Deep AI Summarization**: Connect any OpenAI-compatible API, DeepSeek, or local Ollama model to generate rich narrative project summaries.
- 🚀 **Instant Session Resumption**: Automatically prints or copies the exact resume command for each tool:
  - `claude --resume <id>`
  - `codex resume <id>`
  - `agy --conversation <id>`
  - `kimi --session <id>`
  - `dsh-tui --resume <id>`
- 🎯 **Smart Weighted BM25 Search**: Matches against Title (6x), Keywords (5x), Deliverable Artifacts (4x), Summary (3x), User Queries (2x), and Status (1x). Prioritizes your current working directory automatically.
- 🖥️ **Interactive Terminal TUI**: Run `recall -i` to navigate through sessions with keyboard arrows and press `Enter` to resume.
- 🔌 **Native Model Context Protocol (MCP) Server**: Run `recall mcp` to let Claude Desktop, Cursor, Windsurf, or Antigravity search your past sessions as an MCP tool!

---

## 🚀 Quick Start

### Installation

```bash
# Install globally via npm
npm install -g harness-recall

# Or run directly via npx without installation
npx harness-recall "database deadlock"
```

### Basic Commands

```bash
# Search sessions (prioritizes current project, falls back across all projects)
recall "redis cache deadlock"

# List all unfinished, in-progress, or interrupted sessions
recall unfinished
recall "payment" --unfinished

# Filter by session status (已完成 | 进行中 | 中断 | 待继续 | 仅咨询)
recall --status=进行中
recall --status=中断

# Search explicitly across all projects
recall "authentication jwt" --all

# Filter by a specific AI harness
recall "refactor" --source=claude
recall "benchmark" --source=codex

# Filter by project directory name
recall "payment" --project=my-saas-app

# Interactive selector mode (TUI - press 'u' to filter unfinished)
recall -i

# Inspect full details and transcript excerpt of top match
recall "migration" --detail

# Output structured JSON for automation scripts
recall "parser" --json

# Check index statistics & discovery breakdown
recall status

# Run background incremental digest manually
recall digest

# View current configuration and storage paths
recall config
```

---

## 🔌 Using as an MCP Server

`agent-recall` implements the standard [Model Context Protocol (MCP)](https://modelcontextprotocol.io). You can expose it as a tool to Claude Desktop, Cursor, or any MCP-compatible agent.

### Claude Desktop Configuration (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "agent-recall": {
      "command": "npx",
      "args": ["-y", "harness-recall", "mcp"]
    }
  }
}
```

Now Claude can call `recall_sessions` or `get_session_detail` to look up what you built previously!

---

## 🤖 Using as an Agent Skill (Claude Code / Codex / Antigravity / Kimi / DSH)

`agent-recall` ships with a ready-to-use Agent Skill definition at `skills/session-recall/SKILL.md`.

Simply link or copy it to your agent skills directory:
```bash
# For Claude Code
mkdir -p ~/.claude/skills/session-recall
cp skills/session-recall/SKILL.md ~/.claude/skills/session-recall/

# For Codex CLI
mkdir -p ~/.codex/skills/session-recall
cp skills/session-recall/SKILL.md ~/.codex/skills/session-recall/

# For Google Antigravity
mkdir -p ~/.gemini/config/skills/session-recall
cp skills/session-recall/SKILL.md ~/.gemini/config/skills/session-recall/

# For Kimi Code
mkdir -p ~/.kimi-code/skills/session-recall
cp skills/session-recall/SKILL.md ~/.kimi-code/skills/session-recall/
```

When you type `/session-recall <query>` or ask *"what did we do with the payment webhook last week?"*, your agent will automatically invoke `recall` and rerank the results with relevant resumption commands.

---

<a name="chinese"></a>
## 🇨🇳 中文说明

### 解决的核心痛点

在多 Agent 协同编程的日常工作中，开发者经常在 **Claude Code**、**Codex CLI**、**Antigravity**、**Kimi Code**、**DSH** 之间切换。每个工具的历史会话各自割裂，会话文件深藏在系统各个隐藏目录中，回溯历史非常痛苦：
1. **记忆黑洞**：“上次那个支付回调 bug 是在哪个工具里调通的？”
2. **上下文丢失**：“当时架构选型的关键依据是什么？”
3. **恢复繁琐**：“怎么才能一键重新打开当时的会话窗口？”

`agent-recall` 彻底脱离了单一 Agent 宿主插件（Skill）的限制，作为一个独立的系统级 CLI，实现本地会话全盘语义索引与毫秒级召回。

### 核心亮点

1. **跨 Harness 全流派归一**：原生支持 Claude Code、Codex、Antigravity、Kimi Code、DSH 五大生态。
2. **免 Key 纯本地零成本模式 (Zero-LLM)**：默认无需配置任何 API Key，100% 本地分析提炼关键词与交付物，开箱即用。
3. **可选大模型深度归纳**：配置 OpenAI / DeepSeek / 本地 Ollama 即可自动生成高质量中文叙事摘要。
4. **一键直达原现场**：自动生成对应工具的原生唤醒命令（`claude --resume`、`codex resume`、`agy --conversation`、`kimi --session` 等）。
5. **交互式终端 TUI**：支持 `recall -i` 上下箭头浏览会话卡片与回车直达。
6. **MCP 协议双向赋能**：内置 `recall mcp`，可作为标准 MCP Server 接入 Claude Desktop、Cursor 或任意宿主。

---

## 🛠️ 配置说明

配置文件路径：`~/.config/agent-recall/config.json`（可选，默认开箱即用）。
数据存储路径：`~/.local/state/agent-recall/`（纯本地存储，绝不上传私有代码）。

```json
{
  "zeroLlm": false,
  "llm": {
    "baseUrl": "https://api.deepseek.com/v1",
    "apiKey": "sk-your-key-here",
    "model": "deepseek-chat"
  }
}
```

你也可以直接使用标准环境变量：
- `OPENAI_API_KEY` 或 `AGENT_RECALL_API_KEY`
- `OPENAI_BASE_URL` 或 `AGENT_RECALL_API_URL`
- `OPENAI_MODEL` 或 `AGENT_RECALL_MODEL`

---

## 🤝 参与贡献 (Contributing)

欢迎提交 Issue 和 Pull Request！如果你希望新增对 Aider、Cursor、Windsurf、Roo Code 等工具的支持，只需在 `lib/sources/` 中添加对应的源适配器即可。

```bash
git clone https://github.com/Weicoz/agent-recall.git
cd agent-recall
npm test
```

---

## 📄 License

[MIT License](LICENSE) © 2026 Weicoz
