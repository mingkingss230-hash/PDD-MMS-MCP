// 确保在短信验证步骤 → 点获取验证码 → 回报倒计时状态
import { chromium } from 'playwright-core';
const port = process.argv[2];
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
try {
  for (const ctx of browser.contexts()) {
    for (const page of ctx.pages()) {
      if (!/mms\.pinduoduo\.com\/login/.test(page.url())) continue;
      let vis = await page.evaluate(() => {
        const i = document.querySelector('input[placeholder*="短信验证码"]');
        return i && (i.offsetParent || i.getClientRects().length);
      });
      if (!vis) {
        await page.locator('text=账号登录').first().click();
        await page.waitForTimeout(1200);
        vis = await page.evaluate(() => {
          const i = document.querySelector('input[placeholder*="短信验证码"]');
          return i && (i.offsetParent || i.getClientRects().length);
        });
      }
      if (!vis) { console.log(port, JSON.stringify({ error: '短信输入框不可见，可能需重新走账密' })); continue; }
      const clicked = await page.evaluate(() => {
        const el = [...document.querySelectorAll('a,button,span,div')]
          .filter((e) => e.children.length === 0 && /^获取验证码$/.test((e.textContent || '').trim())
                   && (e.offsetParent || e.getClientRects().length))[0];
        if (!el) return false;
        el.click();
        return true;
      });
      await page.waitForTimeout(3000);
      const after = await page.evaluate(() =>
        [...document.querySelectorAll('a,button,span,div')]
          .filter((e) => e.children.length === 0 && /获取验证码|还剩|重新发送/.test((e.textContent || '').trim()))
          .map((e) => (e.textContent || '').trim()).slice(0, 2));
      console.log(port, JSON.stringify({ smsStepVisible: !!vis, clicked, after }));
    }
  }
} finally { await browser.close(); }
