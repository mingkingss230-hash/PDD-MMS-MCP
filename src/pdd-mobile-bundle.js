import { getPddMobileGoods } from './pdd-mobile.js';
import { listPddMobileReviews, listPddSelectedPrints, listPddExpertNotes } from './pdd-mobile-reviews.js';

function withoutRaw(value) {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(withoutRaw);
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'raw') continue;
    out[key] = withoutRaw(item);
  }
  return out;
}

export async function collectPddMobileBundle(page, {
  goodsId,
  waitMs = 6000,
  reviewPages = 1,
  reviewPageSize = 20,
  includeSelectedPrints = true,
  includeExpertNotes = false,
  includeRaw = false,
} = {}) {
  if (!goodsId) throw new Error('goodsId 必填');
  const goods = await getPddMobileGoods(page, goodsId, { waitMs });
  const reviews = reviewPages > 0
    ? await listPddMobileReviews(page, { goodsId, pageSize: reviewPageSize, pages: reviewPages })
    : null;
  const selectedPrints = includeSelectedPrints && reviewPages > 0
    ? await listPddSelectedPrints(page, { goodsId, pageSize: reviewPageSize, pages: reviewPages })
    : null;
  const expertNotes = includeExpertNotes
    ? await listPddExpertNotes(page, { goodsId, pageSize: 100 })
    : null;
  const result = {
    goodsId: String(goodsId),
    source: {
      goods: 'buyer-page React/rawData',
      reviews: '/proxy/api/reviews/{goods_id}/list',
      selectedPrints: 'reviews endpoint label_id=800000000',
      expertNotes: '店透视页面使用隐藏内部请求函数；当前买家端未暴露可验证 endpoint',
    },
    goods,
    reviews,
    selectedPrints,
    expertNotes,
  };
  return includeRaw ? result : withoutRaw(result);
}
