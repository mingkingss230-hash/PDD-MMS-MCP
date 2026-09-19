// 切回账号登录页签，确认短信验证步骤是否还在
import { chromium } from 'playwright-core';
const port = process.argv[2];
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
try {
  for (const ctx of browser.contexts()) {
    for (const page of ctx.pages()) {
      if (!/mms\.pinduoduo\.com\/login/.test(page.url())) continue;
      const state1 = await page.evaluate(() => document.body.innerText.slice(0, 300));
      if (/请输入短信验证码/.test(state1)) { console.log(port, 'SMS step already active'); continue; }
      const tab = page.locator('text=账号登录').first();
      await tab.click();
      await page.waitForTimeout(1200);
      const state2 = await page.evaluate(() => document.body.innerText.slice(0, 300));
      const hasSms = /请输入短信验证码/.test(state2);
      const hasPwd = /请输入密码/.test(state2);
      console.log(port, JSON.stringify({ hasSms, hasPwd }));
    }
  }
} finally { await browser.close(); }
