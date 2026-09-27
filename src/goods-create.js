import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mmsRequest } from './bridge.js';
import { STORE_IMAGE } from './config.js';

export const GOODS_COMMIT_EDIT = '/glide/mms/goodsCommit/action/edit';
export const GOODS_DECORATION_SAVE = '/glide/forward/gorse/mms/goods/decoration/commit/save';
export const GOODS_ADD_URL = 'https://mms.pinduoduo.com/goods/goods_add/index';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_MIME = new Map([
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
]);

/**
 * Image order is data, not presentation. Never sort these arrays here.
 * The skill layer decides natural-number/main/detail/SKU ordering and passes
 * the resulting arrays to this module unchanged.
 */
export function validateImagePathList(paths) {
  if (!Array.isArray(paths)) throw new TypeError('图片路径必须是数组');
  const normalized = paths.map((p) => {
    if (typeof p !== 'string' || !p.trim()) throw new Error('图片路径不能为空');
    return p;
  });
  const keys = normalized.map((p) => path.resolve(p));
  const dup = keys.find((p, i) => keys.indexOf(p) !== i);
  if (dup) throw new Error(`图片路径重复: ${dup}`);
  return normalized;
}

export function buildOrderedImagePlan({ carouselPaths = [], detailPaths = [], skuImages = [] }) {
  const carousel = validateImagePathList(carouselPaths);
  const detail = validateImagePathList(detailPaths);
  const sku = skuImages.map((item) => {
    if (!item || typeof item !== 'object' || typeof item.path !== 'string' || !item.path.trim()) {
      throw new Error('skuImages 的每项必须包含 path');
    }
    if (typeof item.spec !== 'string' || !item.spec.trim()) throw new Error('SKU 图片必须包含 spec');
    return { path: item.path, spec: item.spec };
  });
  const all = [...carousel, ...detail, ...sku.map((x) => x.path)];
  const duplicate = all.map((p) => path.resolve(p)).find((p, i, a) => a.indexOf(p) !== i);
  if (duplicate) throw new Error(`不同图片角色不能复用同一文件: ${duplicate}`);
  return [
    ...carousel.map((p) => ({ role: 'carousel', path: p })),
    ...detail.map((p) => ({ role: 'detail', path: p })),
    ...sku.map((x) => ({ role: 'sku', path: x.path, spec: x.spec })),
  ];
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function propertyListFromTemplate(template) {
  const root = template?.result ?? template ?? {};
  return (root.modules || []).flatMap((module) => (module.propertys || []).map((property) => ({
    ...property,
    templateModuleId: module.id,
  })));
}

/** Parse the category property template returned by /draco-ms/mms/template/mall. */
export function parseGoodsPropertyTemplate(template) {
  const root = template?.result ?? template ?? {};
  return {
    templateId: root.id ?? null,
    properties: propertyListFromTemplate(template).map((property) => ({
      name: property.name_alias,
      templatePid: property.id,
      templateModuleId: property.templateModuleId,
      pid: property.pid,
      refPid: property.ref_pid,
      required: Boolean(property.required),
      chooseMaxNum: property.choose_max_num ?? null,
      selected: (property.goods_properties || []).map((item) => ({
        vid: item.vid,
        content: item.v_value ?? item.value ?? '',
      })),
      options: (property.values?.content || []).map((item) => ({
        vid: item.vid,
        content: item.value,
      })),
    })),
  };
}

/** Resolve business-facing property names/values to the page's exact payload shape. */
export function buildGoodsProperties(template, selections) {
  if (!Array.isArray(selections)) throw new TypeError('商品属性必须是数组');
  const properties = propertyListFromTemplate(template);
  return selections.map((selection, index) => {
    if (!selection || typeof selection.name !== 'string' || typeof selection.content !== 'string') {
      throw new Error(`商品属性第${index + 1}项必须包含 name 和 content`);
    }
    const property = properties.find((item) => item.name_alias === selection.name);
    if (!property) throw new Error(`未知商品属性: ${selection.name}`);
    const option = (property.values?.content || []).find((item) => item.value === selection.content);
    if (!option) throw new Error(`${selection.name}无此平台选项: ${selection.content}`);
    return {
      template_pid: property.id,
      template_module_id: property.templateModuleId,
      ref_pid: property.ref_pid,
      pid: property.pid,
      vid: option.vid,
      value: selection.value ?? '',
      value_unit: selection.valueUnit ?? property.value_unit ?? '',
      content: option.value,
    };
  });
}

function galleryEntries(urls, type) {
  return urls.map((url) => ({ url, type, file_id: null }));
}

function cents(value, label) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} 不是有效价格: ${value}`);
  return Math.round(number * 100);
}

function yuanString(value, label) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${label} 不是有效价格: ${value}`);
  return String(value);
}

function buildSkuRows({ templateSkus, skuRows, skuUrlBySpec }) {
  const prototype = Array.isArray(templateSkus) && templateSkus.length ? templateSkus[0] : {};
  return skuRows.map((row, index) => {
    if (!row || typeof row.spec !== 'string' || !row.spec.trim()) throw new Error(`SKU 第${index + 1}行缺少 spec`);
    const next = {
      ...clone(prototype),
      id: row.id ?? 0,
      spec: row.spec,
      is_onsale: row.isOnsale ?? row.is_onsale ?? 1,
      spec_id_list: row.specIdList ?? row.spec_id_list ?? [],
      quantity_delta: Number(row.stock ?? row.quantity_delta ?? 0),
      out_sku_sn: row.outSkuSn ?? row.out_sku_sn ?? '',
    };
    if (!Array.isArray(next.spec_id_list)) throw new Error(`SKU ${row.spec} 的 spec_id_list 必须是数组`);
    if (!Number.isFinite(next.quantity_delta) || next.quantity_delta < 0) throw new Error(`SKU ${row.spec} 的库存无效`);

    const groupYuan = row.groupPriceYuan ?? row.multiPriceInYuan ?? row.multi_price_in_yuan;
    const priceYuan = row.priceYuan ?? row.priceInYuan ?? row.price_in_yuan;
    const groupCents = row.groupPrice != null ? Number(row.groupPrice) : cents(groupYuan, `${row.spec} 拼单价`);
    const priceCents = row.price != null ? Number(row.price) : cents(priceYuan, `${row.spec} 单买价`);
    if (!Number.isFinite(groupCents) || !Number.isFinite(priceCents)) throw new Error(`SKU ${row.spec} 缺少价格`);
    next.multi_price = groupCents;
    next.price = priceCents;
    next.multi_price_in_yuan = yuanString(groupYuan ?? groupCents / 100, `${row.spec} 拼单价`);
    next.price_in_yuan = yuanString(priceYuan ?? priceCents / 100, `${row.spec} 单买价`);
    if (skuUrlBySpec.has(row.spec)) next.thumb_url = skuUrlBySpec.get(row.spec);
    return next;
  });
}

/** Build the page-shaped payload while preserving unknown platform fields. */
export function buildGoodsCommitPayload({
  template = {},
  payload = {},
  goodsId,
  goodsCommitId,
  carouselUrls = [],
  detailUrls = [],
  skuUrls = [],
  skuRows = null,
  properties = null,
  mode = 'submit',
}) {
  if (!['draft', 'submit'].includes(mode)) throw new Error('mode 只能是 draft 或 submit');
  const base = { ...clone(template || {}), ...clone(payload || {}) };
  if (goodsId != null) base.goods_id = Number(goodsId);
  if (goodsCommitId != null) base.goods_commit_id = String(goodsCommitId);
  if (!base.goods_id || !base.goods_commit_id) throw new Error('goods_id 和 goods_commit_id 必填');

  const skuUrlBySpec = new Map();
  for (const item of skuUrls || []) {
    if (!item || typeof item.spec !== 'string' || typeof item.url !== 'string' || !item.url) {
      throw new Error('skuUrls 的每项必须包含 spec 和 url');
    }
    if (skuUrlBySpec.has(item.spec)) throw new Error(`SKU 规格重复: ${item.spec}`);
    skuUrlBySpec.set(item.spec, item.url);
  }

  if (carouselUrls.length || detailUrls.length) {
    base.gallery = [
      ...galleryEntries(carouselUrls, 1),
      ...galleryEntries(detailUrls, 2),
    ];
  }
  if (Array.isArray(properties)) {
    const selectedByRefPid = new Map(properties.map((item) => [String(item.ref_pid), item]));
    const existing = Array.isArray(base.goods_properties) ? base.goods_properties : [];
    const merged = existing.map((item) => selectedByRefPid.get(String(item.ref_pid)) || item);
    const existingRefs = new Set(existing.map((item) => String(item.ref_pid)));
    base.goods_properties = [...merged, ...properties.filter((item) => !existingRefs.has(String(item.ref_pid)))];
  }
  if (Array.isArray(base.skus)) {
    if (Array.isArray(skuRows)) {
      base.skus = buildSkuRows({ templateSkus: base.skus, skuRows, skuUrlBySpec });
    } else {
      base.skus = base.skus.map((sku) => {
        const next = { ...sku };
        if (skuUrlBySpec.has(String(sku.spec))) next.thumb_url = skuUrlBySpec.get(String(sku.spec));
        return next;
      });
      if (mode === 'submit' && skuUrlBySpec.size && base.skus.some((sku) => !String(sku.spec || '').trim())) {
        throw new Error('提交 SKU 仍是空规格；必须传 skuRows 重建真实 SKU');
      }
    }
  } else if (Array.isArray(skuRows)) {
    base.skus = buildSkuRows({ templateSkus: [], skuRows, skuUrlBySpec });
  }
  if (mode === 'submit' && (!Array.isArray(base.skus) || !base.skus.length)) {
    throw new Error('提交商品必须包含至少一条 SKU');
  }
  base.is_auto_save = mode === 'draft';
  base.is_draft = mode === 'draft';
  return base;
}

export function classifyGoodsCommitResponse(raw) {
  const body = raw && raw.data && typeof raw.data === 'object' && typeof raw.data.success === 'boolean'
    ? raw.data
    : raw;
  if (body && body.success === true && (body.result === true || body.result === 1 || body.result?.success === true)) {
    return { ok: true };
  }
  if (body && body.success === false) {
    const error = body.errorMsg || body.error_msg || body.errorCode || body.error_code;
    return { ok: false, error: String(error || '接口返回失败') };
  }
  throw new Error('无法识别商品提交接口响应');
}

function readImageFile(filePath) {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) throw new Error(`图片不存在: ${absolute}`);
  const stat = fs.statSync(absolute);
  if (!stat.isFile()) throw new Error(`不是文件: ${absolute}`);
  if (stat.size > MAX_IMAGE_BYTES) throw new Error(`图片超过 10MB: ${absolute}`);
  const ext = path.extname(absolute).toLowerCase();
  const mime = IMAGE_MIME.get(ext);
  if (!mime) throw new Error(`不支持的图片格式: ${ext || '(无扩展名)'}`);
  return {
    path: absolute,
    filename: path.basename(absolute),
    mime,
    base64: fs.readFileSync(absolute).toString('base64'),
  };
}

async function uploadOneImage(page, file, timeoutMs) {
  const task = page.evaluate(async ({ file, url }) => {
    const signatureResponse = await window.__mms.fetch.post('/galerie/business/get_signature', { bucket_tag: 'mms-goods-image' });
    const signature = signatureResponse?.signature
      || signatureResponse?.result?.signature
      || signatureResponse?.data?.signature
      || signatureResponse?.data?.result?.signature;
    if (!signature) throw new Error('获取商品图片上传签名失败');
    const bin = atob(file.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const form = new FormData();
    form.append('image', new File([bytes], file.filename, { type: file.mime }));
    form.append('upload_sign', signature);
    const response = await fetch(url, { method: 'POST', body: form, credentials: 'omit' });
    const text = await response.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch { throw new Error(`图片上传响应不是 JSON: ${text.slice(0, 120)}`); }
    if (!response.ok || !json.url) throw new Error(`图片上传失败(${response.status}): ${json.error || json.error_msg || text.slice(0, 160)}`);
    return { url: json.url, processedUrls: json.processed_urls || [], width: json.width, height: json.height, size: json.size };
  }, { file, url: STORE_IMAGE });
  return Promise.race([
    task,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`图片上传超时(${timeoutMs}ms): ${file.path}`)), timeoutMs)),
  ]);
}

/** Upload one-by-one in the supplied order. No Promise.all/batching here. */
export async function uploadGoodsImages(page, paths, { timeoutMs = 90000 } = {}) {
  const ordered = validateImagePathList(paths);
  const files = ordered.map(readImageFile);
  const uploaded = [];
  for (const file of files) {
    const result = await uploadOneImage(page, file, timeoutMs);
    uploaded.push({ path: file.path, ...result });
  }
  if (uploaded.length !== ordered.length) throw new Error('图片上传数量校验失败');
  return uploaded;
}

export async function submitGoodsCommit(page, request) {
  const result = await mmsRequest(page, 'post', GOODS_COMMIT_EDIT, request, 90000);
  if (!result.ok) throw new Error(`商品提交失败: ${result.error || '未知错误'}`);
  return { ...classifyGoodsCommitResponse(result.raw), raw: result.raw, data: result.data };
}

/**
 * Capture a full request-shaped template from the existing goods_add page.
 * This is intentionally a helper, not an exposed business workflow: the
 * skill decides which draft and which fields are safe to reuse.
 */
export async function captureGoodsCommitTemplate(page, { goodsId, goodsCommitId, timeoutMs = 45000 } = {}) {
  if (!goodsId || !goodsCommitId) throw new Error('goodsId 和 goodsCommitId 必填');
  const target = `${GOODS_ADD_URL}?type=add&from=category&version=predictCate&id=${encodeURIComponent(goodsCommitId)}&goods_id=${encodeURIComponent(goodsId)}`;
  let captured = null;
  const onRequest = (request) => {
    if (request.method() !== 'POST' || !request.url().includes(GOODS_COMMIT_EDIT)) return;
    try { captured = JSON.parse(request.postData() || 'null'); } catch { /* ignore malformed */ }
  };
  page.on('request', onRequest);
  try {
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    const deadline = Date.now() + timeoutMs;
    while (!captured && Date.now() < deadline) await page.waitForTimeout(500);
  } finally {
    page.removeListener('request', onRequest);
  }
  if (!captured) throw new Error('未捕获 goodsCommit/action/edit 请求；请确认草稿可编辑且页面已加载完成');
  return captured;
}

export { ROOT };
