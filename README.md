# PDD-MMS-MCP

拼多多商家后台（mms.pinduoduo.com）MCP 工具集。通过 CDP 接管**已登录的 Chrome**，在商家后台页面主世界调用平台自带的 `window.__mms.fetch` 发请求——`anti-content` 风控签名由页面代码自己生成，本工具不做任何签名或请求头伪造，网络层面与人工打开后台查询一致。

## 工作原理

```
MCP 客户端（Hermes / Claude Desktop / ZCode …）
  → 本 server（stdio）
  → CDP（http://127.0.0.1:9222，浏览器级 WebSocket + Target.attachToTarget）
  → 已登录的 mms 商家后台页面
  → 后台内部接口（/sydney/…、/saturn/… 等），返回明文 JSON
```

- 登录态来自专用 Chrome profile 的持久会话，本仓库**不存账号密码**；多店铺账号配置在本地 `config/shops.json`（已 gitignore，格式参考 `config/shops.example.json`）。
- Chrome 153+ 页面级 CDP 端点不回包，传输层必须走 `/json/version` 的 browser 端 WebSocket + `Target.attachToTarget(flatten:true)`。

## 工具清单（15 个）

| 工具 | 说明 |
|---|---|
| `pdd_status` | 环境检查：CDP 端口、登录态、当前 mms 标签页与 mallId |
| `pdd_reviews_list` | 店铺评价列表（跨页、去重、支持待举报过滤与关键词过滤） |
| `pdd_capture_reviews_template` | 抓取评价接口请求体模板（调试用） |
| `pdd_chat_users` | 客服账号列表（mmsId + 名称） |
| `pdd_chat_data` | 客服聊天记录查询（按客服/订单/商品，纯 JSON） |
| `pdd_overview_data` | 经营总览数据（成交金额、退款、访客、转化等） |
| `pdd_goods_data` | 商品维度数据（全店商品今昨指标，旁路捕获+字体解密） |
| `pdd_goods_detail` | 单品数据拉取与聚合（分时销量、售后质量、领航员得分、体检分、评价概况，5 个明文接口合并返回） |
| `pdd_goods_navigator` | 全店商品领航员列表（得分百分位、质量退款率、中差评率、库存等） |
| `pdd_promotion_data` | 营销中心推广数据（全部单元：花费/ROI/GMV/订单/日限额等） |
| `pdd_promotion_list` | 商品推广全量列表及汇总（分页去重、店铺身份核验） |
| `pdd_promotion_detail` | 单个推广的分日/24 小时/创意日报（只读） |
| `pdd_promotion_operations` | 单推广链接操作记录（只读，事件 ID 去重） |
| `pdd_promotion_creative_daily` | 单链接创意图片日报 |
| `pdd_promotion_export` | 原生推广报表下载（生成只读报表任务、下载 XLS、解析 manifest） |

**分层约定**：本仓库只提供**获取（与经用户明确授权的提交）能力**——工具负责把后台数据原样拉回并做身份/分页/日期核验。采集范围、报表编排、分析口径、文案与授权边界属于调用方的 skill/提示词层，不在本仓库。

## 快速开始

```bash
npm install
# 1. 启动带调试端口的专用 Chrome（首次需扫码登录商家后台）
scripts\start-chrome-debug.bat
# 2. 启动 MCP server（stdio）
npm start
```

客户端配置示例（stdio）：

```json
{ "mcp": { "servers": { "pdd-mms-mcp": {
  "command": "node",
  "args": ["<本仓库绝对路径>/src/index.js"]
} } } }
```

## 目录结构

```
src/        MCP server 与各取数模块（工具能力层）
scripts/    取数、导出与运维脚本（Chrome 启动、登录诊断、聊天导出等）
config/     本地配置模板（真实 shops.json 已 gitignore）
docs/       接口笔记
```

## 依赖

Node.js 18+；Python（仅 `pdd_promotion_export` 解析 XLS 时需要 openpyxl/xlrd）。npm 依赖见 `package.json`。

## 风险与边界

- 本项目为**非官方**工具，与拼多多无关。使用即表示你自行承担平台规则风险：自动化访问商家后台可能违反平台服务协议，请仅在合规范围内、以人工操作相当的低频方式使用。
- 评价举报属写操作，必须用户明确授权范围与理由，提交后读回验证；低星本身不构成举报依据，禁止用于恶意举报。
- 运行时产物（`output/`、`logs/`）含客户聊天与评价数据，严禁入库或外传。

## License

MIT
