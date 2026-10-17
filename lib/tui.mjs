import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { localTime, relativeTime } from './store.mjs';

export function runInteractiveTui(results) {
  if (!process.stdin.isTTY) {
    console.log('⚠️ Interactive mode requires a TTY terminal.');
    return;
  }

  if (!results || results.length === 0) {
    console.log('没有找到匹配的历史会话。');
    return;
  }

  let selectedIndex = 0;
  let filterUnfinishedOnly = false;
  let activeList = results;

  function updateActiveList() {
    if (filterUnfinishedOnly) {
      activeList = results.filter((r) => r.isUnfinished);
    } else {
      activeList = results;
    }
    selectedIndex = Math.min(selectedIndex, Math.max(0, activeList.length - 1));
  }

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);

  function clearScreen() {
    process.stdout.write('\x1b[2J\x1b[0;0H');
  }

  function render() {
    clearScreen();
    console.log('\x1b[1m\x1b[36m=== Agent Recall 交互式会话选择器 ===\x1b[0m');
    console.log(`\x1b[90m↑/↓ 切换 | Enter: 恢复会话 | u: 只看未完成 (${filterUnfinishedOnly ? '\x1b[33m开启\x1b[90m' : '关闭'}) | q: 退出\x1b[0m\n`);

    if (activeList.length === 0) {
      console.log('\x1b[33m未找到未完成状态的会话。按 u 返回查看全部。\x1b[0m\n');
      return;
    }

    for (let i = 0; i < activeList.length; i++) {
      const r = activeList[i];
      const isSel = (i === selectedIndex);
      const pointer = isSel ? '\x1b[32m▶ \x1b[1m' : '  ';
      const statusColor = r.status === '已完成' ? '\x1b[32m'
        : r.status === '进行中' ? '\x1b[33m'
        : r.status === '中断' ? '\x1b[31m'
        : r.status === '待继续' ? '\x1b[35m'
        : '\x1b[36m';
      const statusBadge = `${statusColor}[${r.status || '已完成'}]\x1b[0m`;
      const label = `[${r.sourceLabel}] [${r.projectLabel || r.project}] ${r.title} ${statusBadge}`;
      const line = `${pointer}${label}\x1b[0m`;
      console.log(line);
      if (isSel) {
        const lastTs = r.lastTime || r.time;
        console.log(`    \x1b[90m最后活动: ${r.lastTimeFormatted || localTime(lastTs)} (${r.relativeTime || relativeTime(lastTs)})${r.statusReason ? ` | 说明: ${r.statusReason}` : ''}\x1b[0m`);
        console.log(`    \x1b[33m摘要: \x1b[0m${r.summary || '（暂无）'}`);
        if (r.resume) {
          console.log(`    \x1b[35m恢复: \x1b[0m\x1b[4m${r.resume}\x1b[0m`);
        }
        console.log('');
      }
    }
  }

  render();

  process.stdin.on('keypress', (str, key) => {
    if (key.name === 'q' || (key.ctrl && key.name === 'c')) {
      process.stdin.setRawMode(false);
      clearScreen();
      process.exit(0);
    } else if (key.name === 'u') {
      filterUnfinishedOnly = !filterUnfinishedOnly;
      updateActiveList();
      render();
    } else if (key.name === 'up' && activeList.length > 0) {
      selectedIndex = (selectedIndex - 1 + activeList.length) % activeList.length;
      render();
    } else if (key.name === 'down' && activeList.length > 0) {
      selectedIndex = (selectedIndex + 1) % activeList.length;
      render();
    } else if (key.name === 'return' && activeList.length > 0) {
      process.stdin.setRawMode(false);
      clearScreen();
      const sel = activeList[selectedIndex];
      console.log(`\x1b[32m已选择会话: \x1b[1m${sel.title}\x1b[0m`);
      if (sel.resume) {
        console.log('\x1b[36m执行恢复命令:\x1b[0m');
        console.log(`\x1b[1m${sel.resume}\x1b[0m\n`);
      }
      process.exit(0);
    }
  });
}
