import { chromium } from 'playwright-core';
import { getShop } from './shops.js';
import { CDP_URL } from './config.js';

let browserCache = null;
export class CdpError extends Error {}
function cdpUrlFor(shop) { return shop?.port ? `http://127.0.0.1:${shop.port}` : CDP_URL; }
export async function getBrowser({ fresh = false, shop = null } = {}) {
  const shopCfg = shop ? getShop(shop) : null;
  const key = cdpUrlFor(shopCfg);
  if (browserCache && !fresh && browserCache.key === key) {
    try { browserCache.browser.contexts(); return browserCache.browser; } catch { browserCache = null; }
  }
  try {
    const browser = await chromium.connectOverCDP(key, { timeout: 5000 });
    browserCache = { key, browser };
    return browser;
  } catch (e) {
    throw new CdpError(`无法连接 Chrome 调试端口 ${key}（${e.message.split('\n')[0]}）。` +
      `请先运行 pdd-mcp\\scripts\\start-chrome-debug.bat${shopCfg ? ' ' + shopCfg.name : ''} 启动该店铺的调试 Chrome 并登录。`);
  }
}
export async function closeBrowser() { if (browserCache) { try { await browserCache.browser.close(); } catch {} browserCache = null; } }
function pageHost(page) { try { return new URL(page.url()).host; } catch { return ''; } }
export async function getMmsPage({ create = true, shop = null } = {}) {
  const browser = await getBrowser({ shop });
  for (const ctx of browser.contexts()) for (const page of ctx.pages()) if (/^mms\.pinduoduo\.com$/i.test(pageHost(page))) return page;
  if (!create) return null;
  const ctx = browser.contexts()[0]; if (!ctx) throw new CdpError('浏览器没有可用上下文');
  const page = await ctx.newPage(); await page.goto('https://mms.pinduoduo.com/home', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}); return page;
}
export async function getPddMobilePage({ create = true, shop = null } = {}) {
  const browser = await getBrowser({ shop });
  for (const ctx of browser.contexts()) for (const page of ctx.pages()) if (/^(mobile|pifa)\.yangkeduo\.com$/i.test(pageHost(page)) || /\.pinduoduo\.com$/i.test(pageHost(page)) && page.url().includes('/goods.html')) return page;
  if (!create) return null;
  const ctx = browser.contexts()[0]; if (!ctx) throw new CdpError('浏览器没有可用上下文');
  return ctx.newPage();
}
export async function waitForMmsFetch(page, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await page.evaluate(() => Boolean(window.__mms?.fetch && typeof window.__mms.fetch.get === 'function' && typeof window.__mms.fetch.post === 'function')).catch(() => false)) return true;
    await page.waitForTimeout(500);
  }
  return false;
}
