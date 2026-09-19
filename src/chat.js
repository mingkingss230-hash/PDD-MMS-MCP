import {
  CHAT_USERS, MSG_USERS, MSG_USERS_BY_GOODS, MSG_BY_ORDER, MSG_LIST,
  LIMITS,
} from './config.js';
import { mmsRequest } from './bridge.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 'YYYY-MM-DD' → 当日起止 unix 秒 */
export function dateRangeToUnix(startDate, endDate) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(startDate) || !re.test(endDate)) throw new Error('日期格式须为 YYYY-MM-DD');
  const s = Math.floor(new Date(`${startDate}T00:00:00`)/ 1000);
  const e = Math.floor(new Date(`${endDate}T23:59:59`) / 1000);
  if (s > e) throw new Error('开始日期晚于结束日期');
  return { startTime: s, endTime: e };
}

function assertSpan({ startTime, endTime }, maxDays, label) {
  if (endTime - startTime > maxDays * 24 * 3600) {
    throw new Error(`${label}时间跨度不能超过 ${maxDays} 天（与拼多多后台一致）`);
  }
}

function pickId(o) { return o ? (o.uid ?? o.userId ?? o.id ?? o.mmsId) : undefined; }
function pickName(o) { return o ? (o.nickname || o.userName || o.username || String(pickId(o) ?? '未知账号')) : '未知账号'; }
function pickAvatar(o) {
  const t = o ? (o.avatar || o.avatarUrl || o.headUrl || o.headImg || o.headImage || '') : '';
  const s = typeof t === 'string' ? t.trim() : '';
  return s.startsWith('//') ? `https:${s}` : s;
}
function fmtTime(v) {
  const num = Number(v);
  if (!num || Number.isNaN(num)) return '';
  const ms = num > 1e12 ? num : num * 1000;
  const d = new Date(ms);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function parseMessageItem(m) {
  if (m && typeof m === 'object') return m;
  if (typeof m === 'string') {
    try {
      const p = JSON.parse(m);
      return p && typeof p === 'object' ? p : { content: m, type: 0 };
    } catch { return { content: m, type: 0 }; }
  }
  return {};
}

const IMG_RE = /https?:\/\/[^\s"']+\.(?:png|jpe?g|webp|gif)/i;

/** 消息归一化（兜底链还原自店透视 normalizeMessages） */
function normalizeMessage(raw, session) {
  const m = parseMessageItem(raw);
  // 发送方只看 direction（店透视原版逻辑）：csname/csId 挂在会话所有消息上，不代表发送方
  const isCs = Boolean(m.direction);
  let content = m.content;
  if (content && typeof content === 'object') content = JSON.stringify(content);
  const picUrl = m.picUrl || m.imageUrl || m.imgUrl || m.image || (typeof content === 'string' && IMG_RE.test(content) ? (content.match(IMG_RE) || [''])[0] : '');
  const timeRaw = m.time ?? m.ts ?? m.createTime ?? m.sendTime ?? m.msgTime;
  return {
    avatar: isCs ? '' : (pickAvatar(session) || pickAvatar(m)),
    buyerName: session.buyerName,
    csName: (m.csname || m.csName) || session.csName || '',
    sender: isCs ? '客服' : '消费者',
    type: m.type ?? m.msgType ?? 0,
    content: content ?? '',
    picUrl: picUrl || '',
    time: fmtTime(timeRaw),
  };
}

function normalizeSession(u, csNameDefault = '') {
  return {
    uid: pickId(u),
    buyerName: pickName(u),
    avatar: pickAvatar(u),
    csName: csNameDefault,
    messageCount: 0, firstTime: '', lastTime: '',
  };
}

/** 客服账号列表 GET /chats/getMallUsers */
export async function listCsAccounts(page) {
  const r = await mmsRequest(page, 'get', CHAT_USERS);
  if (!r.ok) throw new Error(`获取客服账号失败: ${r.error}`);
  const list = Array.isArray(r.data.userList) ? r.data.userList : [];
  return list.map((u) => ({ mmsId: u.mmsId, name: u.username || u.userName || String(u.mmsId ?? '') })).filter((x) => x.name);
}

/**
 * 导出聊天记录。mode:
 *  - cs:    按时间+客服账号（mmsId 可选）拉全部会话，再逐会话拉消息
 *  - order: 按订单号拉消息
 *  - goods: 按商品 ID 拉会话再逐会话拉消息
 */
export async function exportChats(page, {
  mode, startDate, endDate, mmsId, orderSn, goodsId,
  maxConversations = 100, maxMessagesPerConv = 0,
  intervalMs = LIMITS.chatIntervalMs, onProgress = () => {},
}) {
  if (mode === 'order' && !orderSn) throw new Error('mode=order 需要 orderSn');
  if (mode === 'goods' && !goodsId) throw new Error('mode=goods 需要 goodsId');

  const times = dateRangeToUnix(startDate, endDate);
  assertSpan(times, mode === 'goods' ? LIMITS.chatSpanGoodsDays : LIMITS.chatSpanCsDays, mode === 'goods' ? '按商品查询' : '按客服/订单查询');

  const sessions = [];
  const messages = [];
  const warnings = [];

  if (mode === 'order') {
    const pageSize = 20;
    let pageNum = 0; // 该接口 pageNum 从 0 起（店透视 buildOrderParams: e-1）
    for (let guard = 0; guard < 500; guard++) {
      const r = await mmsRequest(page, 'post', MSG_BY_ORDER, {
        orderSn, pageNum, pageSize, keywords: '', ...times,
      });
      if (!r.ok) throw new Error(`订单消息接口失败: ${r.error}`);
      const list = Array.isArray(r.data.messageList) ? r.data.messageList : [];
      const userInfo = r.data.userInfo && typeof r.data.userInfo === 'object' ? r.data.userInfo : {};
      const csName = userInfo.csName || userInfo.csname || '';
      if (pageNum === 0) {
        const s = normalizeSession({ uid: orderSn, nickname: userInfo.nickname || userInfo.userName || orderSn }, csName);
        sessions.push(s);
      }
      const norm = list.map((m) => normalizeMessage(m, sessions[0]));
      sessions[0].messageCount += norm.length;
      if (norm.length) {
        sessions[0].firstTime = sessions[0].firstTime || norm[0].time;
        sessions[0].lastTime = norm[norm.length - 1].time || sessions[0].lastTime;
      }
      messages.push(...norm);
      const total = Number(r.data.total) || messages.length;
      if (messages.length >= total || list.length < pageSize) break;
      pageNum++;
      await sleep(intervalMs);
    }
    onProgress(`订单 ${orderSn}: ${messages.length} 条消息`);
    return { sessions, messages, warnings };
  }

  // cs / goods：先拉会话列表
  let convUsers = [];
  if (mode === 'cs') {
    const pageSize = 20;
    let pageNum = 1;
    let total = null;
    for (let guard = 0; guard < 100; guard++) {
      const body = { pageNum, pageSize, keywords: '', ...times };
      if (mmsId) body.mmsId = mmsId;
      const r = await mmsRequest(page, 'post', MSG_USERS, body);
      if (!r.ok) throw new Error(`会话列表接口失败: ${r.error}`);
      const list = Array.isArray(r.data.convUsers) ? r.data.convUsers : [];
      total = total ?? (Number(r.data.total) || null);
      convUsers.push(...list);
      if (convUsers.length >= (total ?? Infinity) || list.length < pageSize) break;
      if (maxConversations && convUsers.length >= maxConversations) break;
      pageNum++;
      await sleep(intervalMs);
    }
  } else {
    const r = await mmsRequest(page, 'post', MSG_USERS_BY_GOODS, { goodsId: Number(goodsId), ...times });
    if (!r.ok) throw new Error(`按商品查会话失败: ${r.error}`);
    convUsers = Array.isArray(r.data.convUsers) ? r.data.convUsers : [];
  }

  if (maxConversations && convUsers.length > maxConversations) {
    warnings.push(`会话共 ${convUsers.length} 个，按 maxConversations=${maxConversations} 截断`);
    convUsers = convUsers.slice(0, maxConversations);
  }

  for (let i = 0; i < convUsers.length; i++) {
    const u = convUsers[i];
    const session = normalizeSession(u);
    sessions.push(session);
    const pageSize = 20;
    let pageNum = 1;
    let total = null;
    for (let guard = 0; guard < 500; guard++) {
      const r = await mmsRequest(page, 'post', MSG_LIST, {
        uid: session.uid, pageNum, pageSize, ...times,
      });
      if (!r.ok) { warnings.push(`会话 ${session.uid}(${session.buyerName}) 第 ${pageNum} 页拉取失败: ${r.error}`); break; }
      const list = Array.isArray(r.data.contentList) ? r.data.contentList : [];
      total = total ?? (Number(r.data.total) || null);
      const norm = list.map((m) => normalizeMessage(m, session));
      session.messageCount += norm.length;
      if (norm.length) {
        session.firstTime = session.firstTime || norm[0].time;
        session.lastTime = norm[norm.length - 1].time || session.lastTime;
      }
      messages.push(...norm);
      if (maxMessagesPerConv && session.messageCount >= maxMessagesPerConv) {
        warnings.push(`会话 ${session.uid} 达到 maxMessagesPerConv=${maxMessagesPerConv} 截断`);
        break;
      }
      if ((total !== null && session.messageCount >= total) || list.length < pageSize) break;
      pageNum++;
      await sleep(intervalMs);
    }
    onProgress(`[${i + 1}/${convUsers.length}] ${session.buyerName}: ${session.messageCount} 条`);
    await sleep(intervalMs);
  }

  return { sessions, messages, warnings };
}
