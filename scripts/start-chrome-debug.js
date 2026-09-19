#!/usr/bin/env node
// 启动指定店铺的调试 Chrome（多店铺：每个店铺独立端口 + 独立 profile）
// 用法: node scripts/start-chrome-debug.js [店铺名]
//   店铺名取自 config/shops.json 的键；省略时用第一个店铺（无 shops.json 时退回 9222 默认 profile）
import { exec } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shopName = process.argv[2] || null;

function readShops() {
  const file = path.join(ROOT, 'config', 'shops.json');
  if (!fs.existsSync(file)) return {};
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete j._说明;
    return j;
  } catch { return {}; }
}

function portAlive(port) {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/json/version', timeout: 2000 }, (res) => { res.resume(); resolve(true); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

function findChrome() {
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

const shops = readShops();
const names = Object.keys(shops);
const shop = shopName || names[0] || null;
const cfg = shop ? shops[shop] : null;
const port = (cfg && cfg.port) || 9222;
const profile = path.join(process.env.LOCALAPPDATA || '', 'pdd-mcp', 'chrome-profile' + (shop ? '-' + shop : ''));

const chrome = findChrome();
if (!chrome) { console.error('[!] 未找到 Chrome，请检查安装'); process.exit(1); }

if (await portAlive(port)) {
  console.log(`[i] 店铺「${shop || '默认'}」的调试 Chrome 已在运行（端口 ${port}）`);
  exec(`start "" "${chrome}" "https://mms.pinduoduo.com/home"`, { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
  process.exit(0);
}

console.log(`[i] 启动店铺「${shop || '默认'}」调试 Chrome: 端口=${port} profile=${profile}`);
// 用 cmd start 启动（ShellExecute 脱离父进程 Job Object，父进程退出后 Chrome 仍存活）
const cmdLine = `start "" "${chrome}" --remote-debugging-port=${port} --user-data-dir=${profile} --no-first-run --no-default-browser-check https://mms.pinduoduo.com/home`;
exec(cmdLine, { detached: true, stdio: 'ignore' }, () => {});
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 500));
  if (await portAlive(port)) { console.log('[i] 调试 Chrome 已启动'); process.exit(0); }
}
console.error('[!] 调试 Chrome 启动超时');
process.exit(1);
