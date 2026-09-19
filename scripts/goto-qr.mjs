// 把登录页切到扫码登录页签，显示二维码
import { chromium } from 'playwright-core';
const port = process.argv[2];
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
try {
  for (const ctx of browser.contexts()) {
    for (const page of ctx.pages()) {
      if (!/mms\.pinduoduo\.com\/login/.test(page.url())) continue;
      const tab = page.locator('text=扫码登录').first();
      await tab.click();
      await page.waitForTimeout(1500);
      const qr = await page.evaluate(() => {
        const img = document.querySelector('img[src*="qr"], img[src*="QR"], canvas, img[class*="qr"]');
        const box = document.querySelector('[class*="qrcode"],[class*="QrCode"],[class*="erwei"]');
        return { qrImg: !!img, qrBox: !!box };
      });
      console.log(port, JSON.stringify(qr));
    }
  }
} finally { await browser.close(); }
