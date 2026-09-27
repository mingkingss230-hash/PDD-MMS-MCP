import { mmsRequest } from './bridge.js';
import { evalPageFunction } from './pdd-mobile.js';

export const PDD_MOBILE_REVIEW_PATH = '/proxy/api/reviews';
export const PDD_MOBILE_SHOP_COMMENT = 'https://mobile.yangkeduo.com/proxy/api/reviews/{goods_id}/list';
export const PDD_MOBILE_SELECTED_PRINT = PDD_MOBILE_SHOP_COMMENT;
export const PDD_MOBILE_EXPERT_NOTE = null;
export const PDD_MOBILE_EXPERT_NOTE_INVOCATION = 'v.c({ goods_id, page, size, channel })';
export const PDD_MOBILE_PICTURE_LABEL_ID = 800000000;

const pictureDetails = (x) => (Array.isArray(x) ? x : x ? [x] : [])
  .map((v) => typeof v === 'string' ? { url: v } : ({ url: v?.url || v?.image_url || v?.imageUrl || v?.thumb_url || v?.thumbUrl || '', width: v?.width ?? null, height: v?.height ?? null, picMd5: v?.pic_md5 ?? v?.picMd5 ?? null, type: v?.type ?? null }))
  .filter((v) => v.url);
const pictureList = (x) => pictureDetails(x).map((v) => v.url);
const videoList = (x) => (Array.isArray(x) ? x : x ? [x] : []).map((v) => typeof v === 'string' ? v : v?.url || v?.video_url || v?.videoUrl || '').filter(Boolean);
const skuText = (x) => Array.isArray(x) ? x.map((s) => `${s?.spec_key ?? s?.specKey ?? s?.key ?? ''}:${s?.spec_value ?? s?.specValue ?? s?.value ?? ''}`).filter((s) => s !== ':').join(';') : x && typeof x === 'object' ? skuText([x]) : String(x || '');
const normalizeReview = (x) => ({ reviewId: String(x?.review_id ?? x?.reviewId ?? x?.reviewIdStr ?? ''), buyer: x?.name ?? x?.userName ?? x?.userNick ?? '', avatar: x?.avatar ?? x?.userAvatar ?? '', comment: x?.comment ?? x?.content ?? '', appendComment: x?.append_comment ?? x?.appendComment ?? '', appendCount: Number(x?.append_num ?? x?.appendNum ?? 0), specs: skuText(x?.specs ?? x?.spec ?? x?.sku_specs), skuId: x?.sku_id == null ? null : String(x.sku_id), pictures: pictureList(x?.pictures ?? x?.comment_pictures ?? x?.commentPictures), pictureDetails: pictureDetails(x?.pictures ?? x?.comment_pictures ?? x?.commentPictures), appendPictures: pictureList(x?.append?.pictures ?? x?.append_pictures ?? x?.appendPictures), video: videoList(x?.video ?? x?.comment_video ?? x?.commentVideo)[0] || '', videos: videoList(x?.video ?? x?.comment_video ?? x?.commentVideo), time: x?.time ?? x?.created_at ?? x?.createdAt ?? x?.review_time ?? x?.reviewTime ?? null, scores: { description: x?.desc_score ?? null, logistics: x?.logistics_score ?? null, service: x?.service_score ?? null, comprehensive: x?.comprehensive_dsr ?? null }, raw: x });
async function loadCommentsPage(page, goodsId) { await page.goto(`https://mobile.yangkeduo.com/goods_comments.html?goods_id=${encodeURIComponent(String(goodsId))}&refer_page_app=mms`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {}); await page.waitForTimeout(2500); }
async function fetchReviewPage(page, { goodsId, pageNo, pageSize, labelId }) { const path = `${PDD_MOBILE_REVIEW_PATH}/${encodeURIComponent(String(goodsId))}/list`; const result = await page.evaluate(async ({ path, pageNo, pageSize, labelId }) => { const query = new URLSearchParams({ label_id: String(labelId), page: String(pageNo), size: String(pageSize), enable_video: '1', enable_group_review: '1' }); const response = await fetch(`${path}?${query}`, { credentials: 'include' }); return { status: response.status, url: response.url, json: await response.json().catch(() => ({})) }; }, { path, pageNo, pageSize, labelId }); if (result.status < 200 || result.status >= 300) throw new Error(`买家评价接口失败: HTTP ${result.status}`); const rows = Array.isArray(result.json?.data) ? result.json.data : null; if (!rows) throw new Error('买家评价接口返回结构异常：缺少 data 数组'); return { ...result, rows }; }
async function listReviewPages(page, { goodsId, pageNo = 1, pageSize = 20, labelId = 0, pages = 1 } = {}) { if (!goodsId) throw new Error('goodsId 必填'); if (!Number.isInteger(pageNo) || pageNo < 1) throw new Error('pageNo 必须是正整数'); if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error('pageSize 必须在 1-100'); if (!Number.isInteger(pages) || pages < 1 || pages > 100) throw new Error('pages 必须在 1-100'); await loadCommentsPage(page, goodsId); const pageResults = []; for (let i = 0; i < pages; i += 1) { const currentPage = pageNo + i; const result = await fetchReviewPage(page, { goodsId, pageNo: currentPage, pageSize, labelId }); pageResults.push({ pageNo: currentPage, count: result.rows.length, reviews: result.rows.map(normalizeReview), raw: result.json, requestUrl: result.url }); if (result.rows.length < pageSize) break; } const reviews = pageResults.flatMap((x) => x.reviews); return { goodsId: String(goodsId), labelId, pageNo, pageSize, pagesFetched: pageResults.length, count: reviews.length, hasMore: pageResults.at(-1)?.count === pageSize, reviews, pages: pageResults.map(({ raw, reviews: pageReviews, ...meta }) => ({ ...meta, reviews: pageReviews })), raw: pageResults.map((x) => x.raw) }; }
export async function listPddMobileReviews(page, args = {}) { return listReviewPages(page, { ...args, pages: args.pages ?? 1, labelId: args.labelId ?? 0 }); }
export async function listPddSelectedPrints(page, { goodsId, pageNo = 1, pageSize = 20, pages = 1 } = {}) { const result = await listReviewPages(page, { goodsId, pageNo, pageSize, pages, labelId: PDD_MOBILE_PICTURE_LABEL_ID }); const items = result.reviews.filter((x) => x.pictures.length || x.video); return { ...result, pictureOnly: true, count: items.length, items }; }
export async function listPddExpertNotes(page, { goodsId, pageNo = 1, pageSize = 100 } = {}) {
  if (!goodsId) throw new Error('goodsId 必填');
  return {
    goodsId: String(goodsId),
    pageNo,
    pageSize,
    count: 0,
    items: [],
    warning: '店透视代码中的行家心得请求依赖未公开的页面内部函数；当前买家端未暴露可验证 endpoint，未返回猜测数据',
    raw: { source: 'buyer-page', endpoint: null },
  };
}
export async function fetchPddMobileRenderRaw(page, goodsId) { return evalPageFunction(page, () => window.rawData || { goodsId }, { goodsId }); }
export async function fetchPddMobileViaMmsPage(page, path, body) { const r = await mmsRequest(page, 'post', path, body); if (!r.ok) throw new Error(r.error || 'PDD mobile bridge request failed'); return r.data; }
