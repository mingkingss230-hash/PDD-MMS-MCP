import { getPddMobilePage } from './cdp.js';

export function unwrapPddMobileDetailData(payload) {
  return payload?.props && typeof payload.props === 'object' ? payload.props : payload;
}

export async function evalPageFunction(page, fn, arg, timeoutMs = 60000) {
  return page.evaluate(async ({ fnText, arg, timeoutMs }) => {
    const run = new Function(`return (${fnText})`)();
    const task = Promise.resolve(run(arg));
    return Promise.race([task, new Promise((_, reject) => setTimeout(() => reject(new Error(`页面执行超时(${timeoutMs}ms)`)), timeoutMs))]);
  }, { fnText: fn.toString(), arg, timeoutMs });
}

export async function capturePddMobileGoods(page, goodsId, { waitMs = 8000 } = {}) {
  const url = `https://mobile.yangkeduo.com/goods.html?goods_id=${encodeURIComponent(String(goodsId))}&refer_page_app=mms`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(waitMs);
  return evalPageFunction(page, ({ goodsId }) => {
    const clean = (u) => typeof u === 'string' ? u.replace(/&amp;/g, '&') : '';
    const imageUrl = (x) => clean(typeof x === 'string' ? x : x?.url || x?.imageUrl || x?.image_url || x?.thumbUrl || x?.thumb_url || x?.src || '');
    const imageDetail = (x, index = 0) => ({ url: imageUrl(x), index, width: x?.width ?? null, height: x?.height ?? null, type: x?.type ?? null });
    const imageDetails = (xs) => (xs || []).map((x, i) => imageDetail(x, i)).filter((x) => x.url);
    const unique = (xs) => [...new Set((xs || []).map(imageUrl).filter((x) => x && !x.startsWith('data:')))];
    const specs = (x) => Array.isArray(x) ? x.map((s) => ({ key: s?.spec_key ?? s?.specKey ?? s?.key ?? '', value: s?.spec_value ?? s?.specValue ?? s?.value ?? '', keyId: s?.spec_key_id ?? s?.specKeyId ?? s?.key_id ?? null, valueId: s?.spec_value_id ?? s?.specValueId ?? s?.value_id ?? null, custom: s?.custom ?? false })).filter((s) => s.key || s.value) : (x && typeof x === 'object' ? specs([x]) : []);
    const firstNumber = (...values) => values.find((v) => v !== null && v !== undefined && v !== '' && Number(v) !== 0) ?? null;
    const skuRow = (s, i) => {
      const rawSpecsValue = s?.specs ?? s?.spec_list ?? s?.specList ?? [];
      let rawSpecs = rawSpecsValue;
      if (typeof rawSpecs === 'string') { try { rawSpecs = JSON.parse(rawSpecs); } catch { rawSpecs = []; } }
      const specArray = Array.isArray(rawSpecs) ? rawSpecs : (rawSpecs && typeof rawSpecs === 'object' ? (rawSpecs.spec_key || rawSpecs.spec_value ? [rawSpecs] : rawSpecs[0] ? [rawSpecs[0]] : Object.values(rawSpecs)) : []);
      const normalizedSpecs = specArray.map((x) => ({ key: String(x?.spec_key ?? x?.specKey ?? x?.key ?? ''), value: String(x?.spec_value ?? x?.specValue ?? x?.value ?? ''), keyId: x?.spec_key_id ?? x?.specKeyId ?? x?.key_id ?? null, valueId: x?.spec_value_id ?? x?.specValueId ?? x?.value_id ?? null, custom: x?.custom ?? false })).filter((x) => x.key || x.value);
      if (!normalizedSpecs.length && s?.specText) normalizedSpecs.push({ key: '', value: String(s.specText), keyId: null, valueId: s?.spec ?? null, custom: false });
      return {
        skuId: String(s?.skuID ?? s?.skuId ?? s?.sku_id ?? i + 1),
        specs: normalizedSpecs,
        specText: normalizedSpecs.map((x) => `${x.key}:${x.value}`).join(';'),
        specId: s?.spec ?? s?.specId ?? null,
        thumbUrl: imageUrl(s?.thumbUrl ?? s?.thumb_url ?? s?.skuPic ?? s?.sku_pic ?? s?.url),
        quantity: s?.quantity ?? s?.stock ?? s?.stock_quantity ?? null,
        stock: s?.quantity ?? s?.stock ?? s?.stock_quantity ?? null,
        price: firstNumber(s?.price, s?.groupPrice, s?.normalPrice),
        groupPrice: firstNumber(s?.groupPrice, s?.group_price),
        normalPrice: firstNumber(s?.normalPrice, s?.normal_price),
        oldGroupPrice: s?.oldGroupPrice ?? s?.old_group_price ?? null,
        priceDisplay: s?.priceDisplay ?? s?.price_display ?? null,
        raw: s,
      };
    };
    const normalize = (data) => {
      const root = data?.store?.initDataObj || data?.initDataObj || data || {};
      const g = root.goods || {}; const oak = root.oakData || root.oak_data || {}; const q = root.queries || {};
      const main = unique(g.viewImageData || g.topGallery || g.mainImages || []);
      const detail = unique(g.detailGallery || g.descImages || g.descVideoGallery || []);
      const skus = (g.skus || g.skuList || g.sku_list || []).map(skuRow);
      return { goodsId: String(g.goodsID ?? g.goodsId ?? g.goods_id ?? q.goods_id ?? goodsId), goodsName: g.goodsName ?? g.goods_name ?? g.title ?? '', mall: root.mall || {}, prices: { group: g.minGroupPrice ?? g.groupPrice ?? null, normal: g.minNormalPrice ?? g.normalPrice ?? null, old: g.oldMinOnSaleGroupPriceInCent ?? null }, salesText: g.sideSalesTip ?? '', mainImages: main, mainImageDetails: imageDetails(g.viewImageData || g.topGallery || g.mainImages || []), detailImages: detail, detailImageDetails: imageDetails(g.detailGallery || g.descImages || g.descVideoGallery || []), skuImages: skus.filter((s) => s.thumbUrl).map((s) => ({ skuId: s.skuId, specs: s.specs, specText: s.specText, url: s.thumbUrl })), skus, properties: g.goodsProperty || g.goodsProperties || g.properties || [], review: oak.review || root.review || {}, raw: root };
    };
    const findReactData = () => {
      const seen = new WeakSet();
      const visit = (v, depth = 0) => {
        if (!v || typeof v !== 'object' || depth > 8 || seen.has(v)) return null;
        seen.add(v);
        if (v.goods && (v.goods.goodsID || v.goods.goodsId || v.goods.goods_id)) return v;
        if (v.goodsID && (v.topGallery || v.viewImageData || v.skus || v.detailGallery)) return { goods: v, mall: {}, oakData: {} };
        for (const k of Object.keys(v).slice(0, 80)) {
          if (/^(return|child|sibling|alternate|stateNode|_owner|memoizedState|memoizedProps|pendingProps|updateQueue|dependencies|ref)$/.test(k)) continue;
          try { const x = visit(v[k], depth + 1); if (x) return x; } catch {}
        }
        return null;
      };
      for (const el of document.querySelectorAll('*')) for (const key of Object.keys(el)) {
        if (!key.startsWith('__reactProps')) continue;
        try { const x = visit(el[key]); if (x) return x; } catch {}
      }
      return null;
    };
    const readBuyerSessionStorage = () => {
      try {
        for (const key of Object.keys(sessionStorage)) {
          const value = sessionStorage.getItem(key);
          if (!value || value.length < 100) continue;
          const parsed = JSON.parse(value);
          const props = parsed?.props;
          if (props?.goods && (props.goods.goodsID || props.goods.goodsId || props.goods.goods_id)) return props;
        }
      } catch {}
      return null;
    };
    const raw = readBuyerSessionStorage() || window.rawData || findReactData(); const result = normalize(raw);
    const domImages = unique([...document.images].map((i) => i.currentSrc || i.src).filter((u) => /pddpic|yangkeduo/.test(u)));
    if (!result.mainImages.length) result.mainImages = domImages.slice(0, 10);
    return { url: location.href, loggedIn: !/\/login\.html/.test(location.pathname), data: result, domImages };
  }, { goodsId });
}

export async function getPddMobileGoods(page, goodsId, options = {}) { return capturePddMobileGoods(page, goodsId, options); }
export { getPddMobilePage };
