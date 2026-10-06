import { mmsRequest } from './bridge.js';

export async function getHistoryTrade(page, { startDate, endDate }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    throw new Error('日期必须为 YYYY-MM-DD');
  }
  if (startDate > endDate) throw new Error('开始日期不能晚于结束日期');
  const days = Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000) + 1;
  if (days > 31) throw new Error('历史成交查询范围不能超过31天');
  const rows = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(Date.parse(`${startDate}T00:00:00Z`) + i * 86400000).toISOString().slice(0, 10);
    const r = await mmsRequest(page, 'post', '/sydney/api/mallTrade/queryMallTradeList', { queryType: 0, queryDate: d }, 60000);
    if (!r.ok) throw new Error(`历史成交接口 ${d} 失败: ${typeof r.error === 'object' ? JSON.stringify(r.error) : r.error}`);
    const body = r.raw?.result ?? r.raw;
    const day = (body?.dayList || []).find((x) => x.stateDate === d) || null;
    rows.push({ date: d, found: Boolean(day), data: day });
  }
  return { startDate, endDate, days, rows };
}
