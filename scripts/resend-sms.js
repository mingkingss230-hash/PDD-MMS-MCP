// 读取登录页短信验证码区域的真实状态；--click 时若倒计时结束则点击重发
// 用法: node scripts/resend-sms.js <端口> [--click]
import { chromium } from 'playwright-core';

const port = process.argv[2] || '9222';
const doClick = process.argv.includes('--click');

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
try {
  for (const ctx of browser.contexts()) {
    for (const page of ctx.pages()) {
      if (!/mms\.pinduoduo\.com/.test(page.url())) continue;
      const info = await page.evaluate((click) => {
        const find = (re) => [...document.querySelectorAll('a,button,span,div')]
          .filter((e) => e.children.length === 0 && re.test((e.textContent || '').trim()))
          .map((e) => (e.textContent || '').trim());
        const resend = [...document.querySelectorAll('a,button,span,div')]
          .filter((e) => e.children.length === 0 && /^获取验证码$|重新发送|重新获取/.test((e.textContent || '').trim()));
        let clicked = false;
        if (click && resend.length) { resend[0].click(); clicked = true; }
        return {
          url: location.href,
          hasSmsBox: !!document.querySelector('input[placeholder*="验证码"]'),
          smsTexts: find(/还剩|重新发送|重新获取|验证码/).slice(0, 8),
          clicked,
        };
      }, doClick);
      console.log(JSON.stringify(info));
    }
  }
} finally {
  await browser.close();
}
