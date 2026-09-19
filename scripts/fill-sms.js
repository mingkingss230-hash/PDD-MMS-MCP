// 填入短信验证码并点确认，然后回报页面状态（URL/报错）
// 用法: node scripts/fill-sms.js <端口> <验证码>
import { chromium } from 'playwright-core';

const port = process.argv[2];
const code = process.argv[3];
if (!port || !code) { console.error('用法: node scripts/fill-sms.js <端口> <验证码>'); process.exit(1); }

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
try {
  for (const ctx of browser.contexts()) {
    for (const page of ctx.pages()) {
      if (!/mms\.pinduoduo\.com\/login/.test(page.url())) continue;
      const input = page.locator('input[placeholder*="验证码"]').first();
      await input.fill(code);
      await page.locator('button:has-text("确认")').first().click();
      await page.waitForTimeout(4000);
      const state = await page.evaluate(() => {
        const err = [...document.querySelectorAll('div,span')]
          .filter((e) => e.children.length === 0 && /验证码错误|已失效|不正确|请输入/.test((e.textContent || '').trim()))
          .map((e) => (e.textContent || '').trim());
        return { url: location.href, err: [...new Set(err)].slice(0, 3) };
      });
      console.log(JSON.stringify(state));
    }
  }
} finally {
  await browser.close();
}
