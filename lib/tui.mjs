import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { localTime } from './store.mjs';

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
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);

  function clearScreen() {
    process.stdout.write('\x1b[2J\x1b[0;0H');
  }

  function render() {
    clearScreen();
    console.log('\x1b[1m\x1b[36m=== Agent Recall 交互式会话选择器 ===\x1b[0m');
    console.log('\x1b[90m↑/↓ 切换 | Enter: 复制/执行回到会话 | q: 退出\x1b[0m\n');

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const isSel = (i === selectedIndex);
      const pointer = isSel ? '\x1b[32m▶ \x1b[1m' : '  ';
      const label = `[${r.sourceLabel}] [${r.projectLabel || r.project}] ${r.title}`;
      const line = `${pointer}${label}\x1b[0m`;
      console.log(line);
      if (isSel) {
        console.log(`    \x1b[90m时间: ${localTime(r.time)} | 状态: ${r.status || '已完成'}\x1b[0m`);
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
    } else if (key.name === 'up') {
      selectedIndex = (selectedIndex - 1 + results.length) % results.length;
      render();
    } else if (key.name === 'down') {
      selectedIndex = (selectedIndex + 1) % results.length;
      render();
    } else if (key.name === 'return') {
      process.stdin.setRawMode(false);
      clearScreen();
      const sel = results[selectedIndex];
      console.log(`\x1b[32m已选择会话: \x1b[1m${sel.title}\x1b[0m`);
      if (sel.resume) {
        console.log('\x1b[36m执行恢复命令:\x1b[0m');
        console.log(`\x1b[1m${sel.resume}\x1b[0m\n`);
      }
      process.exit(0);
    }
  });
}
