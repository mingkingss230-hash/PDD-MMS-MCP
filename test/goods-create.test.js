import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOrderedImagePlan,
  buildGoodsCommitPayload,
  classifyGoodsCommitResponse,
  validateImagePathList,
  parseGoodsPropertyTemplate,
  buildGoodsProperties,
} from '../src/goods-create.js';

test('ordered image plan preserves caller order and separates carousel/detail/sku roles', () => {
  const plan = buildOrderedImagePlan({
    carouselPaths: ['10.jpg', '2.jpg', '1.jpg'],
    detailPaths: ['特殊图_02.jpg', '特殊图_01.jpg', '详情页_02.jpg'],
    skuImages: [
      { spec: '米色', path: '米色.jpg' },
      { spec: '黑色', path: '黑色.jpg' },
    ],
  });

  assert.deepEqual(plan.map((x) => [x.role, x.path, x.spec ?? null]), [
    ['carousel', '10.jpg', null],
    ['carousel', '2.jpg', null],
    ['carousel', '1.jpg', null],
    ['detail', '特殊图_02.jpg', null],
    ['detail', '特殊图_01.jpg', null],
    ['detail', '详情页_02.jpg', null],
    ['sku', '米色.jpg', '米色'],
    ['sku', '黑色.jpg', '黑色'],
  ]);
});

test('payload gallery follows uploaded URL order and SKU thumb maps by spec', () => {
  const result = buildGoodsCommitPayload({
    template: { goods_id: 10, goods_commit_id: 'c1', is_auto_save: true },
    payload: {
      goods_name: '测试商品',
      skus: [
        { spec: '黑色', price: 19900, multi_price: 15900 },
        { spec: '米色', price: 19900, multi_price: 15900 },
      ],
    },
    goodsId: 11,
    goodsCommitId: 'c2',
    carouselUrls: ['main-1', 'main-2'],
    detailUrls: ['detail-1'],
    skuUrls: [
      { spec: '米色', url: 'sku-beige' },
      { spec: '黑色', url: 'sku-black' },
    ],
    mode: 'submit',
  });

  assert.deepEqual(result.gallery, [
    { url: 'main-1', type: 1, file_id: null },
    { url: 'main-2', type: 1, file_id: null },
    { url: 'detail-1', type: 2, file_id: null },
  ]);
  assert.deepEqual(result.skus.map((x) => [x.spec, x.thumb_url]), [
    ['黑色', 'sku-black'],
    ['米色', 'sku-beige'],
  ]);
  assert.equal(result.goods_id, 11);
  assert.equal(result.goods_commit_id, 'c2');
  assert.equal(result.is_auto_save, false);
  assert.equal(result.is_draft, false);
});

test('sku rows rebuild placeholder template into real spec rows with cents and spec ids', () => {
  const result = buildGoodsCommitPayload({
    template: {
      goods_id: 1,
      goods_commit_id: 'x',
      skus: [{ spec: '', price: 0, multi_price: 0, quantity_delta: 0 }],
    },
    payload: {},
    skuRows: [
      { spec: '黑色', specIdList: [101], stock: 1000, groupPriceYuan: 159, priceYuan: 199, outSkuSn: 'BLACK' },
      { spec: '米色', specIdList: [102], stock: 900, groupPriceYuan: '159', priceYuan: '199', outSkuSn: 'BEIGE' },
    ],
    skuUrls: [
      { spec: '黑色', url: 'https://img.example/black.jpg' },
      { spec: '米色', url: 'https://img.example/beige.jpg' },
    ],
    mode: 'submit',
  });

  assert.deepEqual(result.skus.map((x) => ({
    spec: x.spec,
    spec_id_list: x.spec_id_list,
    quantity_delta: x.quantity_delta,
    multi_price: x.multi_price,
    price: x.price,
    out_sku_sn: x.out_sku_sn,
    thumb_url: x.thumb_url,
  })), [
    { spec: '黑色', spec_id_list: [101], quantity_delta: 1000, multi_price: 15900, price: 19900, out_sku_sn: 'BLACK', thumb_url: 'https://img.example/black.jpg' },
    { spec: '米色', spec_id_list: [102], quantity_delta: 900, multi_price: 15900, price: 19900, out_sku_sn: 'BEIGE', thumb_url: 'https://img.example/beige.jpg' },
  ]);
});

test('submit rejects SKU image mappings when the final SKU rows are still placeholders', () => {
  assert.throws(() => buildGoodsCommitPayload({
    template: { goods_id: 1, goods_commit_id: 'x', skus: [{ spec: '' }] },
    payload: {},
    skuUrls: [{ spec: '黑色', url: 'https://img.example/black.jpg' }],
    mode: 'submit',
  }), /SKU.*spec|规格/);
});

test('draft mode is explicit and submit mode cannot silently inherit auto-save', () => {
  const draft = buildGoodsCommitPayload({
    template: { goods_id: 1, goods_commit_id: 'x', is_auto_save: true, is_draft: false },
    payload: {},
    carouselUrls: [],
    detailUrls: [],
    skuUrls: [],
    mode: 'draft',
  });
  const submit = buildGoodsCommitPayload({
    template: { goods_id: 1, goods_commit_id: 'x', is_auto_save: true, is_draft: true, skus: [{ spec: '黑色' }] },
    payload: {},
    carouselUrls: [],
    detailUrls: [],
    skuUrls: [],
    mode: 'submit',
  });
  assert.equal(draft.is_auto_save, true);
  assert.equal(draft.is_draft, true);
  assert.equal(submit.is_auto_save, false);
  assert.equal(submit.is_draft, false);
});

test('image validation rejects duplicate paths but does not sort or normalize order', () => {
  assert.deepEqual(validateImagePathList(['10.jpg', '2.jpg']), ['10.jpg', '2.jpg']);
  assert.throws(() => validateImagePathList(['a.jpg', 'a.jpg']), /重复/);
});

test('property template exposes platform ids and selectable values', () => {
  const parsed = parseGoodsPropertyTemplate({
    result: {
      id: 46557,
      modules: [{ id: 61191, propertys: [{
        id: 387622, name_alias: '佩戴方式', pid: 75, ref_pid: 1008,
        required: false, choose_max_num: 1,
        values: { content: [
          { vid: 76311, value: '入耳式' },
          { vid: 1692295, value: '耳夹式' },
        ] },
        goods_properties: [{ vid: 1692295, v_value: '耳夹式', ref_pid: 1008 }],
      }] }],
    },
  });

  assert.deepEqual(parsed, {
    templateId: 46557,
    properties: [{
      name: '佩戴方式', templatePid: 387622, templateModuleId: 61191,
      pid: 75, refPid: 1008, required: false, chooseMaxNum: 1,
      selected: [{ vid: 1692295, content: '耳夹式' }],
      options: [{ vid: 76311, content: '入耳式' }, { vid: 1692295, content: '耳夹式' }],
    }],
  });
});

test('property builder resolves names and content to exact goods_properties rows', () => {
  const template = {
    result: { id: 46557, modules: [{ id: 61191, propertys: [
      { id: 387622, name_alias: '佩戴方式', pid: 75, ref_pid: 1008, values: { content: [{ vid: 1692295, value: '耳夹式' }] } },
      { id: 387623, name_alias: '防水级别', pid: 225, ref_pid: 828, values: { content: [{ vid: 1639410, value: 'IPX7及以上' }] } },
    ] }] },
  };
  assert.deepEqual(buildGoodsProperties(template, [
    { name: '佩戴方式', content: '耳夹式' },
    { name: '防水级别', content: 'IPX7及以上' },
  ]), [
    { template_pid: 387622, template_module_id: 61191, ref_pid: 1008, pid: 75, vid: 1692295, value: '', value_unit: '', content: '耳夹式' },
    { template_pid: 387623, template_module_id: 61191, ref_pid: 828, pid: 225, vid: 1639410, value: '', value_unit: '', content: 'IPX7及以上' },
  ]);
  assert.throws(() => buildGoodsProperties(template, [{ name: '防水级别', content: 'IPX67' }]), /无此平台选项/);
  assert.throws(() => buildGoodsProperties(template, [{ name: '不存在', content: '值' }]), /未知商品属性/);
});

test('payload can replace goods_properties with resolved property rows', () => {
  const properties = [{ template_pid: 387622, template_module_id: 61191, ref_pid: 1008, pid: 75, vid: 1692295, value: '', value_unit: '', content: '耳夹式' }];
  const result = buildGoodsCommitPayload({
    template: { goods_id: 1, goods_commit_id: 'x', goods_properties: [], skus: [{ spec: '黑色' }] },
    payload: {}, properties, mode: 'submit',
  });
  assert.deepEqual(result.goods_properties, properties);
});

test('payload merges selected goods properties by ref_pid and preserves existing brand', () => {
  const properties = [{ template_pid: 387622, template_module_id: 61191, ref_pid: 1008, pid: 75, vid: 1692295, value: '', value_unit: '', content: '耳夹式' }];
  const result = buildGoodsCommitPayload({
    template: { goods_id: 1, goods_commit_id: 'x', goods_properties: [
    { template_pid: 387620, template_module_id: 61191, ref_pid: 310, pid: 5, vid: 13958, value: '', value_unit: '', content: '示例品牌' },
      { template_pid: 387622, template_module_id: 61191, ref_pid: 1008, pid: 75, vid: 76311, value: '', value_unit: '', content: '入耳式' },
    ], skus: [{ spec: '黑色' }] },
    payload: {}, properties, mode: 'submit',
  });
  assert.deepEqual(result.goods_properties, [
    { template_pid: 387620, template_module_id: 61191, ref_pid: 310, pid: 5, vid: 13958, value: '', value_unit: '', content: '示例品牌' },
    properties[0],
  ]);
});

test('commit response classification distinguishes accepted, rejected and malformed responses', () => {
  assert.deepEqual(classifyGoodsCommitResponse({ success: true, result: true }), { ok: true });
  assert.deepEqual(classifyGoodsCommitResponse({ data: { success: false, errorMsg: '校验失败' } }), {
    ok: false,
    error: '校验失败',
  });
  assert.throws(() => classifyGoodsCommitResponse({}), /无法识别/);
});
