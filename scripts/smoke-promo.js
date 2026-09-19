import { getPromotionData } from '../src/promotion.js';

const date = process.argv[2] === 'today' ? 'today' : 'yesterday';
const data = await getPromotionData(null, { date });
console.log('数据日期:', data.数据日期, '| 单元数:', data.推广单元数);
console.log('汇总:', JSON.stringify(data.汇总, null, 1));
console.log('每日花费:', JSON.stringify(data.每日花费));
console.log('\n== 单元（带商品ID）==');
for (const u of data.单元.slice(0, 6)) {
  console.log(` goodsId=${u.goodsId} | ${(u.推广名 || '').slice(0, 16)} | 花费 ${u.花费} | ROI ${u.指标.ROI ?? '-'} | GMV ${u.指标.成交GMV ?? '-'}`);
}
process.exit(0);
