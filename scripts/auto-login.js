#!/usr/bin/env node
// 店铺账密自动登录（移植自 JC0v0/Customer-Agent 的登录流程）
// 用法: node scripts/auto-login.js [店铺名] [--check]
//   --check: 只检查登录态，失效时不自动登录（仅报告）
// 流程: 打开 mms 首页 → 检测登录态 → 失效则进登录页 → 切"账号登录" tab →
//       填 config/shops.json 中的账密 → 提交 → 验证 __mms.fetch 就绪
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getShop } from '../src/shops.js';
import { getBrowser, waitForMmsFetch } from '../src/cdp.js';
import { getEnvInfo } from '../src/bridge.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const shopName = args.find((a) => !a.startsWith('--')) || null;
const checkOnly = args.includes('--check');

const shop = getShop(shopName);

const browser = await getBrowser({ shop: shop.name });
const ctx = browser.contexts()[0];
if (!ctx) { console.error('[!] 浏览器没有可用上下文'); process.exit(1); }
let page = ctx.pages().find((p) => p.url().includes('mms.pinduoduo.com'));
if (!page) page = await ctx.newPage();

const LOGIN_URL = 'https://mms.pinduoduo.com/login/';
const HOME = 'https://mms.pinduoduo.com/home';

async function checkLoggedIn() {
  // 打开首页，5 秒内被踢回 /login 即视为未登录
  await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(5000);
  const url = page.url();
  if (url.includes('/login')) return { loggedIn: false };
  const hasFetch = await page.evaluate(() =>
    Boolean(window.__mms && window.__mms.fetch && typeof window.__mms.fetch.post === 'function')
  ).catch(() => false);
  return { loggedIn: true, hasFetch };
}

console.log(`[i] 店铺「${shop.name}」检查登录态…`);
const st = await checkLoggedIn();
if (st.loggedIn) {
  console.log(JSON.stringify({ ok: true, shop: shop.name, status: '已登录，无需操作', hasMmsFetch: st.hasFetch }));
  process.exit(0);
}
if (checkOnly) {
  console.log(JSON.stringify({ ok: st.loggedIn, shop: shop.name, status: st.loggedIn ? '已登录，无需操作' : '登录态已失效（--check 模式不自动登录）', hasMmsFetch: st.hasFetch }));
  process.exit(st.loggedIn ? 0 : 2);
}

if (!shop.username || !shop.password || String(shop.username).startsWith('你的')) {
  console.error(`[!] 店铺「${shop.name}」的账密未配置：请编辑 pdd-mcp\\config\\shops.json 填入 username/password（首次登录也可手动扫码，之后会话持久）`);
  process.exit(1);
}

console.log('[i] 登录态失效，开始账密自动登录…');
await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 25000 });
await page.waitForTimeout(3000);

let ok = false;
for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
  try {
    // 切到“账号登录”tab（选择器还原自 JC0v0，类名带哈希故用模糊匹配）
    await page.click("div[class*='Common_item']:has-text('账号登录')", { timeout: 8000 }).catch(async () => {
      await page.click("text=账号登录", { timeout: 5000 }).catch(() => {});
    });
    await page.waitForSelector("input[type='text']", { timeout: 10000 });
    await page.fill("input[type='text']", shop.username);
    await page.fill("input[type='password']", shop.password);
    await page.click("button:has-text('登录')");
    console.log(`[i] 第 ${attempt} 次提交登录，等待跳转…`);
    await page.waitForFunction(
      "() => document.title === '拼多多 商家后台' || document.title === '首页' || document.title === '订单查询'",
      { timeout: 30000 },
    ).catch(() => {});
    const st2 = await checkLoggedIn();
    if (st2.loggedIn) { ok = true; break; }
    console.log(`[i] 第 ${attempt} 次登录未成功`);
  } catch (e) {
    console.log(`[i] 第 ${attempt} 次尝试异常: ${e.message.split('\n')[0]}`);
  }
  await page.waitForTimeout(2000);
}

if (!ok) {
  console.log(JSON.stringify({
    ok: false, shop: shop.name,
    status: '自动登录失败（可能触发滑块/短信验证）。请在调试 Chrome 窗口手动完成一次登录，成功后本工具后续可继续自动。',
    hint: '连续失败请勿重试超过 2 次，避免触发风控升级；转人工扫码即可。',
  }));
  process.exit(2);
}

const ready = await waitForMmsFetch(page, 15000);

// 登录成功后记录 mallId 到 shops.json（用于串号检测）
const info = await getEnvInfo(page).catch(() => null);
const mallId = info && info.mallId;
let mismatch = null;
try {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'config', 'shops.json');
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rec = (j[shop.name] = j[shop.name] || {});
  if (rec.mallId && mallId && String(rec.mallId) !== String(mallId)) {
    mismatch = `shops.json 中「${shop.name}」记录的 mallId=${rec.mallId}，与当前登录 mallId=${mallId} 不一致，请确认账号未串`;
  }
  rec.mallId = mallId || rec.mallId;
  fs.writeFileSync(file, JSON.stringify(j, null, 2));
} catch { /* shops.json 写失败不影响登录结果 */ }

console.log(JSON.stringify({
  ok: true, shop: shop.name, status: '自动登录成功', mallId, mismatch,
  hasMmsFetch: ready,
}));
process.exit(0);
