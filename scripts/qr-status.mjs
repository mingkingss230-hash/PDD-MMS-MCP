import { chromium } from 'playwright-core';
const port = process.argv[2];
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
try {
  for (const ctx of browser.contexts()) {
    for (const page of ctx.pages()) {
      if (!/mms\.pinduoduo\.com/.test(page.url())) continue;
      const info = await page.evaluate(() => {
        const t = document.body.innerText;
        const qrTabActive = /扫码登录/.test(t);
        const expired = /已失效|刷新|点击刷新/.test(t);
        return { url: location.href.slice(0, 60), expiredTexts: (t.match(/[^\n]*(已失效|刷新)[^\n]*/) || []).slice(0,3) };
      });
      console.log(port, JSON.stringify(info));
    }
  }
} finally { await browser.close(); }
