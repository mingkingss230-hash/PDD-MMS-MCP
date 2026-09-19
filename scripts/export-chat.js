// 导出客服聊天记录为 Excel（会话 + 消息明细两个 sheet）
// 用法: node scripts/export-chat.js <mode=cs|order|goods> <startDate> <endDate> [mmsId|orderSn|goodsId] [outPath] [--shop=店铺名]
import path from 'node:path';
import { getMmsPage } from '../src/cdp.js';
import { exportChats } from '../src/chat.js';
import { writeChatExcel } from '../src/excel.js';
import { DIRS } from '../src/config.js';

const argv = process.argv.slice(2);
const shopArg = (argv.find((a) => a.startsWith('--shop=')) || '').replace('--shop=', '') || null;
const pos = argv.filter((a) => !a.startsWith('--'));
const [mode = 'cs', startDate, endDate, key, outPath] = pos;
if (!startDate || !endDate) {
  console.error('用法: node scripts/export-chat.js <mode=cs|order|goods> <startDate> <endDate> [mmsId|orderSn|goodsId] [outPath] [--shop=店铺名]');
  process.exit(1);
}

const page = await getMmsPage({ shop: shopArg });
const { sessions, messages, warnings } = await exportChats(page, {
  mode,
  startDate,
  endDate,
  mmsId: mode === 'cs' && key ? key : undefined,
  orderSn: mode === 'order' ? key : undefined,
  goodsId: mode === 'goods' ? key : undefined,
  maxConversations: Number(process.env.MAX_CONVERSATIONS || 100),
});

const file = outPath || path.join(DIRS.output, `聊天记录_${mode}_${startDate}_${endDate}.xlsx`);
await writeChatExcel({ outPath: file, sessions, messages });

console.log(JSON.stringify({
  文件: file,
  会话数: sessions.length,
  消息数: messages.length,
  warnings,
  会话预览: sessions.slice(0, 10).map((s) => ({ 买家: s.buyerName, 消息数: s.messageCount })),
}, null, 2));
process.exit(0);
