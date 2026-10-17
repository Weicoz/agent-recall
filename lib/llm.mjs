import { resolveLlmConfig } from './config.mjs';
import { isActive } from './session-source.mjs';

export const SYSTEM_PROMPT = `你是一个跨 Harness 的 AI 编程会话总结助手。请根据提供的用户发言、助手关键输出和调用的工具，为这次会话生成一份精准的中文索引卡片。

请输出纯 JSON，格式如下：
{
  "title": "简明标题（15字以内，概括本次会话核心目标）",
  "summary": "简练摘要（60~120字，说明做了什么、解决了什么问题，特别写明是否有遗留未完成事项或下一步）",
  "keywords": ["关键词1", "关键词2", "关键词3", "关键词4"],
  "status": "已完成 | 进行中 | 中断 | 待继续 | 仅咨询",
  "isUnfinished": true,
  "statusReason": "说明状态判定原因（如：存在遗留事项待确认/中途报错中断/已交付完成）",
  "artifacts": ["修改或创建的核心文件路径/交付物1", "..."]
}
不得输出 markdown 标记（如 \`\`\`json），只输出纯 JSON 对象。`;

export function buildPrompt(parsed) {
  const L = [];
  L.push(`【项目】：${parsed.meta?.projectLabel || parsed.meta?.projectKey || '未知'}`);
  L.push(`【工作区】：${parsed.meta?.cwd || '未知'}`);
  if (parsed.title) L.push(`【原始标题/首条消息】：${parsed.title}`);

  if (parsed.tools && Object.keys(parsed.tools).length) {
    const t = Object.entries(parsed.tools).map(([k, v]) => `${k}×${v}`).join(', ');
    L.push(`【调用工具】：${t}`);
  }

  L.push('【用户发言列表】：');
  for (const [i, msg] of parsed.userMsgs.slice(0, 15).entries()) {
    const text = msg.length > 300 ? `${msg.slice(0, 300)}…` : msg;
    L.push(`  ${i + 1}. ${text}`);
  }

  if (parsed.assistantTexts && parsed.assistantTexts.length) {
    L.push('【助手最后答复节选】：');
    const last = parsed.assistantTexts[parsed.assistantTexts.length - 1];
    L.push(last.length > 600 ? `${last.slice(0, 600)}…` : last);
  }

  return L.join('\n');
}

/**
 * Heuristically detect session status and whether work is unfinished.
 */
export function detectSessionStatus(parsed) {
  const userTexts = parsed.userMsgs || [];
  const assistantTexts = parsed.assistantTexts || [];

  if (userTexts.length === 0) {
    return { status: '空会话', isUnfinished: false, statusReason: '未产生人工交互' };
  }

  const lastTs = parsed.lastTime || parsed.firstTime || 0;
  if (lastTs && isActive(lastTs)) {
    return { status: '进行中', isUnfinished: true, statusReason: '会话仍在进行中（近期有写入）' };
  }

  if (assistantTexts.length === 0 && userTexts.length > 0) {
    return { status: '中断', isUnfinished: true, statusReason: '用户提问后无回复中断' };
  }

  const lastAssistant = assistantTexts[assistantTexts.length - 1] || '';
  if (/Error:|Exception:|Traceback|fatal:|failed with exit code|运行失败|执行报错|崩溃/i.test(lastAssistant.slice(-400))) {
    return { status: '中断', isUnfinished: true, statusReason: '末尾出现执行错误或崩溃' };
  }

  const UNFINISHED_MARKERS = /遗留|未完成|未结束|下一步|待办|待处理|待确认|待解决|TODO|FIXME/i;
  if (UNFINISHED_MARKERS.test(lastAssistant.slice(-600)) || UNFINISHED_MARKERS.test(userTexts[userTexts.length - 1] || '')) {
    return { status: '待继续', isUnfinished: true, statusReason: '存在明确的遗留事项或下一步计划' };
  }

  if (userTexts.length <= 1 && assistantTexts.length <= 1 && (!parsed.tools || Object.keys(parsed.tools).length === 0)) {
    return { status: '仅咨询', isUnfinished: false, statusReason: '单轮咨询/问答' };
  }

  return { status: '已完成', isUnfinished: false, statusReason: '任务已交互完成' };
}

/**
 * Fast deterministic Zero-LLM summary generator.
 * Runs in < 1ms, requires no network and zero API keys.
 */
export function generateZeroLlmSummary(parsed) {
  const userTexts = parsed.userMsgs || [];
  const firstMsg = (userTexts[0] || '').trim();
  const title = parsed.title || firstMsg.slice(0, 30) || '无标题会话';

  // Extract candidate file paths / artifacts
  const artifactSet = new Set();
  const fileRegex = /(?:[\w.-]+\/)+[\w.-]+\.(?:[a-zA-Z0-9]{1,8})/g;
  for (const msg of userTexts) {
    const matches = msg.match(fileRegex);
    if (matches) {
      for (const m of matches) {
        if (!m.startsWith('http') && !m.includes('node_modules')) {
          artifactSet.add(m);
        }
      }
    }
  }

  // Extract keywords from user queries and tool calls
  const keywordSet = new Set();
  if (parsed.tools) {
    for (const tool of Object.keys(parsed.tools)) {
      keywordSet.add(tool);
    }
  }

  // Chinese/English simple word splitting
  const rawWords = (userTexts.join(' ') + ' ' + (parsed.meta?.projectLabel || ''))
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9_.-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && w.length <= 15);

  const STOP_WORDS = new Set(['这个', '那个', '一下', '怎么', '什么', '可以', '需要', '我们', '你们', '他们', '帮我', '看看', '请问', 'this', 'that', 'with', 'from', 'help']);
  for (const w of rawWords) {
    if (!STOP_WORDS.has(w.toLowerCase())) {
      keywordSet.add(w);
      if (keywordSet.size >= 8) break;
    }
  }

  const statusInfo = detectSessionStatus(parsed);

  const summary = userTexts.length > 0
    ? `围绕「${title.slice(0, 40)}」展开的会话。共 ${userTexts.length} 轮交互${parsed.tools ? `，使用工具：${Object.keys(parsed.tools).slice(0, 4).join(', ')}` : ''}。${statusInfo.isUnfinished ? `（状态：${statusInfo.status} - ${statusInfo.statusReason}）` : ''}`
    : '空会话或仅包含自动化初始化。';

  return {
    title: title.slice(0, 40),
    summary,
    keywords: Array.from(keywordSet).slice(0, 6),
    status: statusInfo.status,
    isUnfinished: statusInfo.isUnfinished,
    statusReason: statusInfo.statusReason,
    artifacts: Array.from(artifactSet).slice(0, 5),
  };
}

/** Call LLM API with timeout and robust error extraction. */
export async function callModel(prompt, llmConfig = null) {
  const config = llmConfig || resolveLlmConfig();
  if (config.zeroLlm || !config.hasKey) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);

  try {
    let body;
    if (config.protocol === 'respond') {
      body = JSON.stringify({
        model: config.model,
        instructions: SYSTEM_PROMPT,
        input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: prompt }] }],
        temperature: 0.2,
      });
    } else {
      body = JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.2,
        response_format: { type: 'json_object' },
      });
    }

    const res = await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body,
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`API error HTTP ${res.status}: ${errText.slice(0, 200)}`);
    }

    const data = await res.json();
    let rawText = '';
    if (config.protocol === 'respond') {
      rawText = data?.output?.[0]?.content?.[0]?.text || '';
    } else {
      rawText = data?.choices?.[0]?.message?.content || '';
    }

    // Clean potential markdown wrap
    const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(cleaned);
  } finally {
    clearTimeout(timer);
  }
}
