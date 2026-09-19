import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..');

export const CDP_URL = process.env.PDD_CDP_URL || 'http://127.0.0.1:9222';
export const MMS_HOST_RE = /(^|\.)mms\.pinduoduo\.com$/i;
export const MMS_HOME = 'https://mms.pinduoduo.com/home';
// 评价管理页候选路由：抓取 /saturn/reviews/list 页面自身请求体时依次尝试
export const REVIEW_PAGE_CANDIDATES = [
  'https://mms.pinduoduo.com/goods/evaluation/index',
  'https://mms.pinduoduo.com/goods/evaluation/index?sellerRightProtect=1',
];

export const REVIEWS_LIST = '/saturn/reviews/list';
export const CREATE_REPORT = '/saturn/reportedReview/edit/createReportedReview';
export const GET_SIGNATURE = '/galerie/business/get_signature';
export const STORE_IMAGE = 'https://file.pinduoduo.com/v3/store_image';

export const CHAT_USERS = '/chats/getMallUsers';
export const MSG_USERS = '/latitude/search/message/getMessagesUsers';
export const MSG_USERS_BY_GOODS = '/latitude/search/message/getMessagesUsersByGoodsId';
export const MSG_BY_ORDER = '/latitude/message/getHistoryMessage';
export const MSG_LIST = '/latitude/search/message/getMessages';

// 店透视还原的官方举报理由表；needDetail/needEvidence 为理由 7/8 的平台强约束
export const REPORT_REASONS = {
  '1': { label: '广告', needDetail: false, needEvidence: false },
  '2': { label: '辱骂', needDetail: false, needEvidence: false },
  '3': { label: '泄露个人隐私', needDetail: false, needEvidence: false },
  '4': { label: '涉黄及低俗内容信息', needDetail: false, needEvidence: false },
  '5': { label: '涉政/暴恐/毒品及枪支信息', needDetail: false, needEvidence: false },
  '6': { label: '其他违反国家法律法规信息', needDetail: false, needEvidence: false },
  '7': { label: '利用评价要挟', needDetail: true, needEvidence: true },
  '8': { label: '同行恶意差评', needDetail: true, needEvidence: true },
  '10': { label: '购买A商品评价B商品', needDetail: false, needEvidence: false },
  '11': { label: '星级与内容矛盾', needDetail: false, needEvidence: false },
};

export const REPORT_STATE = {
  0: '待审核',
  99: '待举报',
  9: '举报失败',
  8: '举报成功',
  10: '已举报',
};

export const LIMITS = {
  maxEvidenceImages: 6,
  maxEvidenceBytes: 3 * 1024 * 1024,
  minDescribeChars: 20,
  chatSpanCsOrderDays: 31,
  chatSpanGoodsDays: 7,
  reportIntervalMs: 1000,
  chatIntervalMs: 300,
};

export const DIRS = {
  logs: path.join(ROOT, 'logs'),
  output: path.join(ROOT, 'output'),
  config: path.join(ROOT, 'config'),
};

for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });

export const AUDIT_LOG = path.join(DIRS.logs, 'pdd_audit.jsonl');
export const REVIEWS_TEMPLATE = path.join(DIRS.config, 'reviews-template.json');
