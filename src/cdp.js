import { chromium } from 'playwright-core';
import { CDP_URL, MMS_HOST_RE, MMS_HOME } from './config.js';
import { getShop } from './shops.js';

let cached = null; // { key, browser } — 按连接目标缓存（多店铺多端口）

export class CdpError extends Error {}

function cdpUrlFor(shop) {
  if (shop && shop.port) return `http://127.0.0.1:${shop.port}`;
  return CDP_URL;
}

export async function getBrowser({ fresh = false, shop = null } = {}) {
  const shopCfg = shop ? getShop(shop) : null;
  const key = cdpUrlFor(shopCfg);
  if (cached && !fresh && cached.key === key) {
    try {
      // 轻量探活：断线后重连
      cached.browser.contexts();
      return cached.browser;
    } catch {
      cached = null;
    }
  }
  try {
    const browser = await chromium.connectOverCDP(key, { timeout: 5000 });
    cached = { key, browser };
    return browser;
  } catch (e) {
    throw new CdpError(
      `无法连接 Chrome 调试端口 ${key}（${e.message.split('\n')[0]}）。` +
        `请先运行 pdd-mcp\\scripts\\start-chrome-debug.bat${shopCfg ? ' ' + shopCfg.name : ''} 启动该店铺的调试 Chrome 并登录。`
    );
  }
}

export async function closeBrowser() {
  if (cached) {
    try { await cached.browser.close(); } catch { /* 忽略 */ }
    cached = null;
  }
}

function pageHost(page) {
  try { return new URL(page.url()).host; } catch { return ''; }
}

/** 找到 mms.pinduoduo.com 标签页；没有则可新建 */
export async function getMmsPage({ create = true, shop = null } = {}) {
  const browser = await getBrowser({ shop });
  const contexts = browser.contexts();
  for (const ctx of contexts) {
    for (const page of ctx.pages()) {
      if (MMS_HOST_RE.test(pageHost(page))) return page;
    }
  }
  if (!create) return null;
  const ctx = contexts[0];
  if (!ctx) throw new CdpError('浏览器没有可用上下文');
  const page = await ctx.newPage();
  await page.goto(MMS_HOME, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  return page;
}

/** 等待页面出现 __mms.fetch（后台应用异步加载完成才有，登录页没有） */
export async function waitForMmsFetch(page, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await page.evaluate(() =>
      Boolean(window.__mms && window.__mms.fetch &&
        typeof window.__mms.fetch.get === 'function' &&
        typeof window.__mms.fetch.post === 'function')
    ).catch(() => false);
    if (ok) return true;
    await page.waitForTimeout(500);
  }
  return false;
}
