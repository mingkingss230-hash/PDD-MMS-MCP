import { STORE_IMAGE } from './config.js';

/**
 * 页面内请求桥：在 mms.pinduoduo.com 页面主世界调用拼多多自带的 window.__mms.fetch，
 * anti-content 签名由拼多多页面代码自己生成（与店透视插件同一原理），本地不做任何签名。
 */

async function evalWithTimeout(page, fn, arg, timeoutMs) {
  return page.evaluate(async ({ fn, arg, timeoutMs }) => {
    const task = (async () => {
      try {
        // fn 以字符串形式传入，在页面主世界还原执行
        const run = new Function(`return (${fn})`)();
        return { __ok: true, value: await run(arg) };
      } catch (e) {
        return { __ok: false, error: (e && (e.message || String(e))) || 'page error' };
      }
    })();
    const timer = new Promise((resolve) =>
      setTimeout(() => resolve({ __ok: false, error: `page evaluate timeout (${timeoutMs}ms)` }), timeoutMs)
    );
    return Promise.race([task, timer]);
  }, { fn: fn.toString(), arg, timeoutMs });
}

function unwrapResult(json) {
  // 店透视 getPayloadResult 同款：解包 .result 最多 3 层
  let t = json && json.data !== undefined ? json.data : json;
  let n = 0;
  while (t && t.result !== undefined && n < 3) { t = t.result; n++; }
  return t || {};
}

/** 调 __mms.fetch；返回 { ok, data(解包result), raw, error } */
export async function mmsRequest(page, method, url, data, timeoutMs = 30000) {
  const fn = async ({ method, url, data }) => {
    const mf = window.__mms && window.__mms.fetch;
    if (!mf || typeof mf[method] !== 'function') {
      const e = new Error('window.__mms.fetch 不可用（未登录或后台未加载完成）');
      e.code = 'NO_MMS_FETCH';
      throw e;
    }
    return method === 'get' ? await mf.get(url) : await mf.post(url, data);
  };
  const r = await evalWithTimeout(page, fn, { method, url, data }, timeoutMs);
  if (!r.__ok) return { ok: false, error: r.error, raw: null };
  const raw = r.value;
  const envelope = raw && raw.data !== undefined && raw.data.success !== undefined ? raw.data : raw;
  const success = envelope && typeof envelope.success === 'boolean' ? envelope.success : true;
  return {
    ok: success,
    data: unwrapResult(raw),
    raw,
    error: success ? null : (typeof (envelope && (envelope.errorMsg || envelope.error_msg)) === 'string'
      ? (envelope.errorMsg || envelope.error_msg)
      : JSON.stringify((envelope && (envelope.errorMsg || envelope.error_msg)) ?? '接口返回失败')),
  };
}

/** 上传举报凭证图：页面内原生 fetch + FormData（无需 anti-content，与店透视一致） */
export async function uploadEvidenceImage(page, { base64, filename, mime }, timeoutMs = 60000) {
  // 签名先取好再上传
  const sig = await mmsRequest(page, 'post', '/galerie/business/get_signature', { bucket_tag: 'review-report' });
  if (!sig.ok || !sig.data.signature) {
    return { ok: false, error: `获取上传签名失败: ${sig.error || '无 signature 字段'}` };
  }
  const fn = async ({ url, base64, filename, mime, uploadSign }) => {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const fd = new FormData();
    fd.append('image', new File([bytes], filename, { type: mime }));
    fd.append('upload_sign', uploadSign);
    const res = await fetch(url, { method: 'POST', body: fd, credentials: 'omit' });
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  };
  const r = await evalWithTimeout(page, fn, { url: STORE_IMAGE, base64, filename, mime, uploadSign: sig.data.signature }, timeoutMs);
  if (!r.__ok) return { ok: false, error: r.error };
  const url = unwrapResult(r.value).url;
  if (!url) return { ok: false, error: '图片上传失败（响应无 url）' };
  return { ok: true, url };
}

/** 登录态/环境信息 */
export async function getEnvInfo(page) {
  const fn = async () => {
    let userinfo = null;
    try { userinfo = JSON.parse(localStorage.getItem('new_userinfo') || 'null'); } catch { /* ignore */ }
    return {
      href: location.href,
      title: document.title,
      hasMmsFetch: Boolean(window.__mms && window.__mms.fetch && typeof window.__mms.fetch.post === 'function'),
      mallId: userinfo ? (userinfo.mall_id ?? null) : null,
    };
  };
  const r = await evalWithTimeout(page, fn, {}, 10000);
  return r.__ok ? r.value : { href: page.url(), hasMmsFetch: false, mallId: null, error: r.error };
}

export { unwrapResult };
