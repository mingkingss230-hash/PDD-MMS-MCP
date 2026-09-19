import path from 'node:path';
import ExcelJS from 'exceljs';
import { DIRS } from './config.js';
import { mmsRequest } from './bridge.js';
import { getGoodsData } from './goods.js';
import { getPromotionData } from './promotion.js';

const THIN = { style: 'thin', color: { argb: 'FFBFBFBF' } };
const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
const SECTION_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };

export const yesterdayStr = () => {
  const d = new Date(Date.now() - 86400000);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** 写文件；若被占用（用户正开着 Excel）则自动改用带时间戳的文件名 */
export async function writeWorkbook(wb, file) {
  try {
    await wb.xlsx.writeFile(file);
    return file;
  } catch (e) {
    if (!/EBUSY|EPERM|locked/i.test(e.message || '')) throw e;
    const t = new Date();
    const p = (x) => String(x).padStart(2, '0');
    const alt = file.replace(/\.xlsx$/, `_${p(t.getHours())}${p(t.getMinutes())}${p(t.getSeconds())}.xlsx`);
    await wb.xlsx.writeFile(alt);
    return alt;
  }
}

function addTable(ws, startRow, headers, rows, opts = {}) {
  const header = ws.getRow(startRow);
  headers.forEach((h, i) => {
    const c = header.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    c.fill = HEADER_FILL;
    c.alignment = { horizontal: 'center', vertical: 'middle' };
    c.border = BORDER;
  });
  header.height = 20;
  rows.forEach((r, ri) => {
    const row = ws.getRow(startRow + 1 + ri);
    r.forEach((v, i) => {
      const c = row.getCell(i + 1);
      c.value = v ?? '';
      c.border = BORDER;
      if (opts.numCols && opts.numCols.includes(i + 1) && typeof v === 'number') c.numFmt = '#,##0.00';
    });
  });
  (opts.widths || []).forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  return startRow + 1 + rows.length;
}

function addSection(ws, row, title, span) {
  const c = ws.getRow(row).getCell(1);
  c.value = title;
  c.font = { bold: true, size: 12 };
  c.fill = SECTION_FILL;
  for (let i = 2; i <= (span || 3); i++) ws.getRow(row).getCell(i).fill = SECTION_FILL;
  return row + 1;
}

const statRow = (d) => d ? {
  访客数: d.goodsUv, 浏览量: d.goodsPv, 支付金额: d.payOrdrAmt, 支付订单: d.payOrdrCnt,
  支付买家数: d.payOrdrUsrCnt, 支付件数: d.payOrdrGoodsQty, 收藏数: d.goodsFavCnt,
  下单转化率: d.ordrVstrRto, 支付转化率: d.payOrdrRto, 商品转化率: d.goodsVcr,
  曝光人数: d.imprUsrCnt, 咨询人数: d.cnsltUsrQty,
} : {};

/* ==================== 数据采集（纯数据，供 MCP 与报表脚本共用） ==================== */

/** 商品报表数据采集：全量商品列表 + 逐商品昨日全天指标（明文）+ 推广数据（昨日） */
export async function collectGoodsReportData(page) {
  const goods = await getGoodsData(page, { withGoodsRows: true });
  const rows = (goods.商品明细 && goods.商品明细.rows) || [];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const yesterdayRows = [];
  for (const r of rows) {
    const s = await mmsRequest(page, 'post', '/sydney/api/goodsDataShow/queryGoodsStatDtr', { goodsId: Number(r.goodsId) });
    const yd = s.ok && s.data && s.data.yesterdayGoodsDetail ? statRow(s.data.yesterdayGoodsDetail) : null;
    const td = s.ok && s.data && s.data.todayGoodsDetail ? statRow(s.data.todayGoodsDetail) : null;
    yesterdayRows.push({
      goodsId: r.goodsId,
      商品名: r.商品名,
      商品编码: r.商品编码 || '—',
      昨日: yd,
      今日参考: td,
      活动: r.活动推荐,
      错误: yd ? null : (s.error || '无数据'),
    });
    await sleep(300);
  }

  const promo = await getPromotionData(null, { date: 'yesterday' });
  return { goods, promo, yesterdayRows };
}

/* ==================== Excel 构建（纯函数：数据进，工作簿出） ==================== */

/** 经营总览工作簿 */
export function buildOverviewWorkbook(data) {
  const date = data.dataDate || yesterdayStr();
  const wb = new ExcelJS.Workbook();
  wb.creator = 'pdd-mcp';

  const ws = wb.addWorksheet('经营指标');
  ws.getRow(1).getCell(1).value = `经营总览（数据日期：${date}）`;
  ws.getRow(1).getCell(1).font = { bold: true, size: 14 };
  let row = 3;
  row = addSection(ws, row, '核心经营指标（昨日）', 3);
  row = addTable(ws, row, ['指标', '数值', '环比昨日'], [], { widths: [24, 18, 12] });
  for (const block of ['交易数据', '商品数据', '服务数据']) {
    const seg = data.经营日数据 && data.经营日数据[block];
    if (!seg) continue;
    const secRow = ws.getRow(row);
    secRow.getCell(1).value = block;
    secRow.getCell(1).font = { bold: true };
    row++;
    for (const [label, v] of Object.entries(seg)) {
      const r2 = ws.getRow(row);
      r2.getCell(1).value = label;
      r2.getCell(2).value = v.value;
      const pct = r2.getCell(3);
      pct.value = typeof v.dayOverDay === 'number' ? v.dayOverDay : '';
      if (typeof v.dayOverDay === 'number') {
        pct.numFmt = '+0.0%;-0.0%;0.0%';
        pct.font = { color: { argb: v.dayOverDay >= 0 ? 'FF008000' : 'FFCC0000' } };
      }
      r2.getCell(1).border = BORDER; r2.getCell(2).border = BORDER; pct.border = BORDER;
      row++;
    }
    row++;
  }
  ws.getColumn(1).width = 26; ws.getColumn(2).width = 16; ws.getColumn(3).width = 12;

  const ws2 = wb.addWorksheet('店铺评分与层级');
  ws2.getRow(1).getCell(1).value = '店铺评分与层级';
  ws2.getRow(1).getCell(1).font = { bold: true, size: 14 };
  const score = data.店铺评分与层级 || {};
  row = 3;
  row = addTable(ws2, row, ['综合得分', '店铺层级', '成交金额'], [[score.综合得分, score.店铺层级, score.成交金额]], { widths: [14, 12, 16] });
  row = addSection(ws2, row + 1, '五维能力（等级/同层百分位/最弱项）', 5);
  row = addTable(ws2, row, ['维度', '等级', '同层百分位', '最弱项1', '最弱项2'],
    (score.维度 || []).map((d) => [d.维度, d.等级, d.同层百分位, d.最弱项[0] && `${d.最弱项[0].项}(${d.最弱项[0].得分})`, d.最弱项[1] && `${d.最弱项[1].项}(${d.最弱项[1].得分})`]),
    { widths: [14, 8, 12, 26, 26], pctCols: [3] });
  const gmv = data.GMV进度 || {};
  row = addSection(ws2, row + 1, 'GMV 升级进度', 4);
  addTable(ws2, row, ['当前GMV', '距升级还差', '当前层级区间下限', '当前层级区间上限'],
    [[gmv.当前GMV, gmv.距升级还差, gmv.当前区间 && gmv.当前区间[0], gmv.当前区间 && gmv.当前区间[1]]], { widths: [16, 16, 18, 18] });

  const ws3 = wb.addWorksheet('客服质量');
  const cs = data.客服质量 || {};
  ws3.getRow(1).getCell(1).value = `客服质量（${cs.statDate || date}）`;
  ws3.getRow(1).getCell(1).font = { bold: true, size: 14 };
  addTable(ws3, 3, ['5分钟回复率', '3分钟回复率', '平均回复时长(秒)', '近3天成交金额'],
    [[cs.replyIn5minRate, cs.replyIn3minRate, cs.avgReplySeconds, cs.dealAmt3d]],
    { widths: [16, 16, 18, 16], pctCols: [1, 2] });

  return wb;
}

/** 商品报表工作簿：商品明细 + 推广数据 按 商品ID 合并为单一 sheet */
export function buildGoodsWorkbook({ promo, yesterdayRows }, yesterday) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'pdd-mcp';

  const ws = wb.addWorksheet(`商品明细+推广_${yesterday}`);
  ws.getRow(1).getCell(1).value = `商品明细 + 推广数据（${yesterday}）`;
  ws.getRow(1).getCell(1).font = { bold: true, size: 14 };

  let row = 3;
  row = addSection(ws, row, '推广账户汇总', 2);
  row = addTable(ws, row, ['指标', '数值'], Object.entries(promo.汇总 || {}).map(([k, v]) => [k, v]), { widths: [20, 16] });

  // 按商品ID聚合推广单元（一个商品可能有多个推广单元：花费/GMV/订单累加，ROI 重算）
  const promoByGoods = new Map();
  for (const u of promo.单元 || []) {
    const key = String(u.goodsId);
    const cur = promoByGoods.get(key) || { spend: 0, gmv: 0, orders: 0, 目标投产比: u.目标投产比, 日限额: u.日限额, units: 0 };
    cur.spend += Number(u.花费) || 0;
    cur.gmv += Number(u.指标 && u.指标.成交GMV) || 0;
    cur.orders += Number(u.指标 && u.指标.订单数) || 0;
    cur.units += 1;
    promoByGoods.set(key, cur);
  }

  row = addSection(ws, row + 1, '商品明细（昨日，含推广数据）', 19);
  const headers = ['商品ID', '商品名', '商品编码(型号)', '访客数', '浏览量', '支付金额', '支付订单', '支付买家数', '支付件数', '商品转化率', '收藏数', '曝光人数', '咨询人数', '推广花费', '推广GMV', '推广订单', '推广ROI', '目标投产比', '日限额', '推广单元数'];
  const widths = [16, 36, 14, 9, 9, 12, 9, 10, 9, 11, 9, 10, 10, 10, 10, 9, 9, 11, 12, 10];
  row = addTable(ws, row, headers, [], { widths });
  for (const r of yesterdayRows) {
    const y = r.昨日 || {};
    const p = promoByGoods.get(String(r.goodsId));
    const roi = p && p.spend > 0 ? Number((p.gmv / p.spend).toFixed(2)) : '—';
    const rowData = [
      r.goodsId, r.商品名, r.商品编码 || '—', y.访客数, y.浏览量, y.支付金额, y.支付订单, y.支付买家数, y.支付件数,
      y.商品转化率, y.收藏数, y.曝光人数, y.咨询人数,
      p ? Number(p.spend.toFixed(2)) : '—', p ? Number(p.gmv.toFixed(2)) : '—', p ? p.orders : '—',
      roi, p ? p.目标投产比 : '—', p ? p.日限额 : '—', p ? p.units : 0,
    ];
    const exRow = ws.getRow(row);
    rowData.forEach((v, i) => {
      const c = exRow.getCell(i + 1);
      c.value = v ?? '';
      c.border = BORDER;
      if ([5, 14, 15].includes(i + 1) && typeof v === 'number') c.numFmt = '#,##0.00';
    });
    row++;
  }

  return wb;
}
