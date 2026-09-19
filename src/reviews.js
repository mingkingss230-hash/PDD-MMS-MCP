import fs from 'node:fs';
import path from 'node:path';
import {
  REVIEWS_LIST, CREATE_REPORT, REVIEW_PAGE_CANDIDATES,
  REPORT_REASONS, REPORT_STATE, LIMITS, REVIEWS_TEMPLATE,
} from './config.js';
import { mmsRequest, uploadEvidenceImage } from './bridge.js';
import { audit } from './audit.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function parseBody(pd) {
  if (!pd) return null;
  try { return JSON.parse(pd); } catch { /* 非 JSON，尝试表单 */ }
  try {
    const o = {};
    for (const [k, v] of new URLSearchParams(pd)) o[k] = v;
    return Object.keys(o).length ? o : null;
  } catch { return null; }
}

function fmtTs(sec) {
  if (!sec) return '';
  const ms = sec > 1e12 ? sec : sec * 1000;
  const d = new Date(ms);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function parseSpecs(specs) {
  try {
    const arr = typeof specs === 'string' ? JSON.parse(specs) : specs;
    return Array.isArray(arr) ? arr.map((s) => `${s.spec_key}:${s.spec_value}`).join('; ') : '';
  } catch { return ''; }
}

/** 抓取评价管理页自身发出的 /saturn/reviews/list 请求体，作为后续翻页的模板 */
export async function captureReviewsTemplate(page, { timeoutMs = 45000 } = {}) {
  const captured = await pageCapture(page, timeoutMs);
  if (!captured.ok) {
    throw new Error(
      `未能抓到 /saturn/reviews/list 请求体。请在调试 Chrome 里手动打开「评价管理」页面` +
        `（登录后左侧菜单：商品管理→评价管理），或确认已登录后重试。详情：${captured.error}`
    );
  }
  fs.writeFileSync(REVIEWS_TEMPLATE, JSON.stringify({ capturedAt: new Date().toISOString(), url: captured.url, body: captured.body }, null, 2));
  return captured;
}

function pageCapture(page, timeoutMs) {
  return new Promise((resolve) => {
    let done = false;
    const cleanup = () => { try { page.removeListener('request', onRequest); } catch { /* */ } };
    const onRequest = (req) => {
      if (done) return;
      if (req.method() === 'POST' && req.url().includes(REVIEWS_LIST)) {
        done = true;
        const body = parseBody(req.postData());
        cleanup();
        if (!body) resolve({ ok: false, error: '请求体解析失败' });
        else resolve({ ok: true, body, url: req.url() });
      }
    };
    page.on('request', onRequest);
    const overall = setTimeout(() => {
      if (!done) { done = true; cleanup(); resolve({ ok: false, error: `等待 ${Math.round(timeoutMs / 1000)}s 未捕获到评价列表请求` }); }
    }, timeoutMs);

    (async () => {
      for (const url of REVIEW_PAGE_CANDIDATES) {
        if (done) return;
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
          await page.waitForTimeout(4000);
        } catch { /* 继续下一个候选 */ }
      }
    })();
    void overall;
  });
}

async function getTemplate(page, { refreshTemplate = false } = {}) {
  if (!refreshTemplate) {
    try {
      const j = JSON.parse(fs.readFileSync(REVIEWS_TEMPLATE, 'utf8'));
      if (j && j.body) return j;
    } catch { /* 无模板则抓取 */ }
  }
  return captureReviewsTemplate(page);
}

export function normalizeReview(it) {
  const st = it.reportResult && it.reportResult.status;
  const scores = [it.descScore, it.serviceScore, it.logisticsScore].filter((x) => typeof x === 'number');
  return {
    reviewId: it.reviewId,
    goodsId: it.goodsId,
    goodsName: it.goodsName,
    itemIdNote: it.goodsId,
    thumbUrl: it.thumbUrl,
    specs: parseSpecs(it.specs),
    buyer: it.name,
    avatar: it.avatar,
    comment: it.comment,
    createTime: fmtTs(it.createTime),
    orderSn: it.orderSn,
    score: scores.length ? Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)) : null,
    replyCount: Array.isArray(it.replyList) ? it.replyList.length : 0,
    reportState: st,
    reportStateLabel: REPORT_STATE[st] ?? (st === undefined || st === null ? '无' : String(st)),
  };
}

/**
 * 跨页拉取评价列表
 * @returns {{reviews:Array, total:number|null, templateApplied:boolean, pagesFetched:number}}
 */
export async function listReviews(page, { pages = 1, pageSize = 20, refreshTemplate = false, templateOverrides } = {}) {
  const tpl = await getTemplate(page, { refreshTemplate });
  const all = [];
  let total = null;
  let fetched = 0;
  for (let p = 1; p <= pages; p++) {
    const body = { ...tpl.body, ...(templateOverrides || {}), pageNo: p, pageSize };
    const r = await mmsRequest(page, 'post', REVIEWS_LIST, body);
    if (!r.ok) throw new Error(`评价列表接口失败（第 ${p} 页）: ${r.error}`);
    const data = Array.isArray(r.data) ? r.data : (r.data && (r.data.data || r.data.list)) || [];
    total = total ?? (r.data && (r.data.totalCount ?? r.data.total ?? r.data.count)) ?? null;
    fetched = p;
    all.push(...data);
    if (data.length < pageSize) break;
    if (p < pages) await sleep(500);
  }
  return { reviews: all.map(normalizeReview), total, pagesFetched: fetched, templateCapturedAt: tpl.capturedAt || null };
}

function validateEvidence(files) {
  const problems = [];
  for (const f of files) {
    if (!/\.(jpe?g|png)$/i.test(f)) problems.push(`凭证仅支持 jpg/jpeg/png: ${f}`);
    let st;
    try { st = fs.statSync(f); } catch { problems.push(`凭证文件不存在: ${f}`); continue; }
    if (st.size > LIMITS.maxEvidenceBytes) problems.push(`凭证超过 3MB: ${f}`);
  }
  return problems;
}

/**
 * 批量举报评价。confirm=false 时只做校验与预览（dryRun），不提交任何请求。
 */
export async function reportReviews(page, {
  reviewIds, reportType, describes, evidenceImages = [],
  confirm = false, intervalMs = LIMITS.reportIntervalMs, stopOnError = true,
}) {
  const reason = REPORT_REASONS[String(reportType)];
  if (!reason) throw new Error(`无效举报理由: ${reportType}（可选: ${Object.keys(REPORT_REASONS).join(', ')}）`);
  const problems = [];

  let describesFinal = null;
  if (reason.needDetail) {
    const d = (describes || '').trim();
    if (d.length < LIMITS.minDescribeChars) {
      problems.push(`理由「${reason.label}」要求 ≥${LIMITS.minDescribeChars} 字的情况说明（当前 ${d.length} 字）`);
    }
    describesFinal = d;
  } else if (describes) {
    describesFinal = describes.trim() || null; // 非必填理由也允许附带说明
  }

  let evidenceFiles = evidenceImages || [];
  if (reason.needEvidence) {
    if (!evidenceFiles.length) problems.push(`理由「${reason.label}」要求至少 1 张凭证图`);
    if (evidenceFiles.length > LIMITS.maxEvidenceImages) problems.push(`凭证最多 ${LIMITS.maxEvidenceImages} 张`);
    problems.push(...validateEvidence(evidenceFiles));
  } else {
    evidenceFiles = []; // 与店透视一致：非 7/8 理由不下发凭证
  }

  if (problems.length) {
    return { dryRun: !confirm, ok: false, problems, submitted: [] };
  }

  const plan = {
    reason: `${reportType}（${reason.label}）`,
    describes: describesFinal,
    evidenceImages: evidenceFiles,
    reviewIds,
    perReviewPayload: {
      pictureUrls: reason.needEvidence ? ['<上传后生成的链接>'] : null,
      reportType: String(reportType),
      reviewId: '<逐条填入>',
      describes: describesFinal,
    },
  };
  if (!confirm) return { dryRun: true, ok: true, plan, note: 'dryRun 预览，未提交任何请求。确认无误后用 confirm:true 执行。' };

  // 上传凭证
  const evidenceUrls = [];
  for (const f of evidenceFiles) {
    const base64 = fs.readFileSync(f).toString('base64');
    const r = await uploadEvidenceImage(page, { base64, filename: path.basename(f), mime: /\.png$/i.test(f) ? 'image/png' : 'image/jpeg' });
    if (!r.ok) throw new Error(`凭证上传失败（${f}）: ${r.error}`);
    evidenceUrls.push(r.url);
    await sleep(300);
  }

  // 逐条举报（与店透视一致：每条间隔 1s，默认失败即停）
  const submitted = [];
  for (const rid of reviewIds) {
    const payload = {
      pictureUrls: reason.needEvidence ? evidenceUrls : null,
      reportType: String(reportType),
      reviewId: rid,
      describes: describesFinal,
    };
    const r = await mmsRequest(page, 'post', CREATE_REPORT, payload);
    const entry = {
      action: 'report_review', reviewId: rid, reportType: String(reportType),
      reason: reason.label, ok: r.ok, error: r.error || null,
    };
    audit(entry);
    submitted.push(entry);
    if (!r.ok && stopOnError) break;
    if (intervalMs > 0) await sleep(intervalMs);
  }
  return {
    dryRun: false, ok: submitted.every((s) => s.ok),
    summary: `提交 ${submitted.length}/${reviewIds.length} 条，成功 ${submitted.filter((s) => s.ok).length} 条`,
    submitted,
    evidenceUrls,
  };
}
