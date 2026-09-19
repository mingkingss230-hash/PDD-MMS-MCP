import ExcelJS from 'exceljs';

function autoWidth(ws, widths) {
  widths.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
}

/** 聊天记录导出：两个 sheet（会话 / 消息明细），列结构与店透视导出版本一致 */
export async function writeChatExcel({ outPath, sessions, messages }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'pdd-mcp';

  const ws1 = wb.addWorksheet('会话');
  ws1.addRow(['消费者账号', '消费者ID(uid)', '客服账号', '消息条数', '首条时间', '末条时间']);
  for (const s of sessions) {
    ws1.addRow([s.buyerName, s.uid, s.csName, s.messageCount, s.firstTime, s.lastTime]);
  }
  autoWidth(ws1, [24, 22, 22, 10, 22, 22]);

  const ws2 = wb.addWorksheet('消息明细');
  ws2.addRow(['消费者头像', '消费者账号', '客服账号', '发送方', '消息类型', '消息内容', '图片链接', '发送时间']);
  for (const m of messages) {
    ws2.addRow([m.avatar, m.buyerName, m.csName, m.sender, m.type, m.content, m.picUrl, m.time]);
  }
  autoWidth(ws2, [40, 24, 22, 10, 10, 60, 50, 22]);

  await wb.xlsx.writeFile(outPath);
  return outPath;
}

/** 评价列表 CSV（带 BOM，Excel 直接打开不乱码） */
export function toReviewsCsv(reviews) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['reviewId', '商品ID', '商品名', '规格', '买家', '评分', '评价内容', '评价时间', '订单号', '回复数', '举报状态'];
  const rows = reviews.map((r) => [
    r.reviewId, r.goodsId, r.goodsName, r.specs, r.buyer, r.score, r.comment,
    r.createTime, r.orderSn, r.replyCount, `${r.reportStateLabel}(${r.reportState})`,
  ].map(esc).join(','));
  return '\uFEFF' + [header.map(esc).join(','), ...rows].join('\r\n');
}
