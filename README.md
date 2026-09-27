# PDD-MMS-MCP

拼多多商家后台（mms.pinduoduo.com）自动化工具集，以 **MCP server** 形式提供：

- **经营数据查询**：经营总览、商品数据、单品分析、商品领航员、推广数据
- **评价管理**：评价列表查询（可筛 1-3 星待举报）
- **客服聊天**：按客服/订单/商品查询聊天记录
- **买家端商品详情与素材**：商品主图/详情图/SKU、商品评价、评价晒图/精选晒图、评价 SKU/评分/图片原始元数据

任何支持 MCP 的客户端（ZCode、Claude Desktop 等）都能调用纯数据接口；带文件产出的操作由 `scripts/` 下的独立脚本完成。

店透视代码分析结论：商品详情由买家端页面初始化数据提供；精选晒图由同一评价接口的图/视频标签提供。行家心得组件在店透视 bundle 中调用隐藏页面内部函数 `v.c({ goods_id, page, size, channel })`，但 bundle 未包含可验证的公开 endpoint，当前 MCP 返回带 warning 的空结果，禁止把候选 URL 当成事实。


## 公开仓库边界

本仓库只保留通用 MCP 能力层与通用测试。以下内容不应提交：店铺登录配置（`config/shops.json`）、本地导出/抓包/调试工件、包含真实业务数据的 JSON/NDJSON/XLSX，以及带店铺身份、外部系统标识或固定业务话术的编排脚本。发布前应执行全历史敏感信息扫描。

## 工作原理

```
MCP 客户端 → 本 server（stdio）→ CDP(127.0.0.1:9222) 接管已登录的 Chrome
  → 在 mms.pinduoduo.com 页面主世界调用 window.__mms.fetch（拼多多后台自带的请求封装）
  → anti-content 风控签名由拼多多页面代码自己生成，本地不做任何签名/请求头伪造
```

商品详情/素材工具使用已登录买家端商品页（`mobile.yangkeduo.com`）的页面上下文和登录态：商品详情读取页面 React/`rawData`，评价实际复用页面发起的 `/proxy/api/reviews/{goods_id}/list`。不要把移动端评价接口改成商家后台 `__mms.fetch`，也不要在 MCP 中伪造 anti-content。
## 环境要求

- Node.js ≥ 18
- Chrome 136+（高版本禁止在默认用户目录开调试端口，本项目使用专用 profile 规避）
- Windows（启动脚本为 bat/cmd；核心代码不依赖平台）

## 快速开始

> ℹ️ **`config/shops.json` 含店铺登录明文账密，不入库**（已 gitignore，且已从全部历史清除）。克隆后复制 `config/shops.example.json` 为 `config/shops.json`，再填入真实账密。

```bash
npm install
```

1. **启动调试 Chrome**：双击 `scripts\start-chrome-debug.bat`（或在 ZCode 对话里让 skill 自动完成）
   - 专用 profile（`%LOCALAPPDATA%\pdd-mcp\chrome-profile`），与日常 Chrome 隔离
   - 首次在打开的窗口里登录商家后台（支持账密自动登录 `scripts/auto-login.js`），之后保持登录
2. **配置店铺**：复制 `config/shops.example.json` 为 `config/shops.json`，填入各店铺的调试端口与登录账密
3. **注册 MCP**（以 ZCode 用户级配置 `~/.zcode/cli/config.json` 为例）：
   ```json
   { "mcp": { "servers": { "pdd-mms-mcp": {
       "command": "node",
       "args": ["<本项目路径>/src/index.js"]
   } } } }
   ```
4. 对话里说"检查拼多多环境"（`pdd_status`）确认就绪。

## MCP 工具清单（纯数据接口，返回 JSON，不产出文件）

| 工具 | 数据 |
|---|---|
| `pdd_status` | 检查 CDP 连接/登录态/请求通道，排障第一步 |
| `pdd_reviews_list` | 评价列表（跨页拉取，可只看待举报、关键词过滤、导出 CSV） |
| `pdd_overview_data` | 经营总览（成交/转化/退款环比、店铺评分五维、GMV 进度、客服质量；前一日） |
| `pdd_goods_data` | 商品数据（昨日全天 + 今日实时 + 活动推荐）+ 推广汇总 |
| `pdd_goods_detail` | 单品深度分析（分时销量趋势/售后质量/领航员得分/体检/评价概况） |
| `pdd_goods_navigator` | 商品领航员列表（综合得分百分位/描述分/质量退款率/拼差率） |
| `pdd_promotion_data` | 推广数据（单元花费/ROI/GMV/订单/日限额，默认昨日） |
| `pdd_promotion_operations` | 单推广链接操作记录（只读、按广告与日期范围） |
| `pdd_promotion_creative_daily` | 单链接创意图片日报（只读，不请求小时数据） |
| `pdd_promotion_export` | 原生推广报表导出与解析（只读） |
| `pdd_promotion_list` | 全量商品推广列表（只读、店铺身份绑定） |
| `pdd_promotion_detail` | 单链接推广日报、分时与创意日报（只读） |
| `pdd_chat_users` | 客服账号列表（mmsId，配合 `pdd_chat_data`） |
| `pdd_chat_data` | 聊天记录查询（按客服 ≤31 天 / 按订单 / 按商品 ≤7 天，纯 JSON） |
| `pdd_capture_reviews_template` | 抓取评价接口请求体模板（排障用） |
| `pdd_goods_upload_images` | 按调用方顺序上传商品图片 |
| `pdd_goods_capture_template` | 捕获商品编辑提交模板（只读） |
| `pdd_goods_property_template` | 读取商品属性模板与平台选项（只读） |
| `pdd_goods_commit` | 保存草稿或提交商品；`submit` 为真实上架操作 |
| `pdd_pdd_mobile_goods` | 买家端商品详情与素材元数据 |
| `pdd_pdd_mobile_reviews` | 买家端评价分页与买家秀 |
| `pdd_pdd_selected_prints` | 买家端图/视频评价筛选 |
| `pdd_pdd_expert_notes` | 行家心得探测；无可验证 endpoint 时返回明确空结果 |
| `pdd_pdd_mobile_bundle` | 一次性汇总买家端商品、评价和素材 |

## 业务编排边界

日报、聊天导出、评价举报、外部报表回填等带店铺身份或业务口径的流程不属于本公开能力层，保留在本地 skill 或部署目录中。公开仓库只保留通用 MCP 工具、平台接口适配和不含真实数据的测试。

## 安全设计

- **逐条间隔 1 秒**（可调但不建议低于 500ms）、单条失败默认停止——不做并发轰炸
- **审计日志**：每次真实举报提交追加记录到 `logs/pdd_audit.jsonl`
- **reviewId 用字符串传**：19 位 ID 超出 JS 安全整数，转数字会丢精度导致举报错对象
- 所有请求带自己的商家登录态，只能操作本店数据
- `output/`（导出的聊天/评价数据）与 `logs/` 一律不入库

## 风险提示（务必阅读）

1. 自动化操作拼多多后台属于平台规则灰色地带，**风控/处罚风险由账号自担**
2. 举报不成立会累积账号投诉记录——建议先用 `pdd_reviews_list` 人工过一遍名单再提交
3. 捏造举报事实会收到平台违规处罚，理由 7/8 的说明请如实填写
4. 调试 Chrome 的 9222 端口对本机所有程序开放（能完全控制该浏览器），不要在不可信环境跑，不用时关掉该 Chrome 窗口

## 目录结构

```
src/               MCP server 代码
  index.js           工具注册与入口（stdio）
  cdp.js / bridge.js CDP 连接与页面内请求调用桥
  config.js / shops.js  配置与多店铺管理
  overview.js / goods.js / promotion.js / reports.js  经营/商品/推广/报表接口
  promotion-*.js     只读推广列表、详情、操作记录与原生报表适配
  goods-create.js    商品图片、属性、草稿/提交能力
  pdd-mobile-*.js    买家端商品与评价读取能力
  reviews.js / chat.js   评价与聊天接口
  font-decrypt.js    商品字体反爬解密
  excel.js / audit.js    Excel 产出与审计日志
scripts/           通用启动、测试与接口验证脚本
config/            shops.example.json（占位模板）；shops.json 存真实账密，不入库
test/              不依赖真实店铺数据的单元测试
docs/api-notes.md  拼多多后台接口笔记（不含店铺数据）
output/  logs/     运行时产物，不入库
```

## 排障

- 所有工具报"无法连接 Chrome 调试端口" → 配置本地调试 Chrome 后重试
- 登录态过期 → 在调试 Chrome 窗口里重新登录
- 评价列表报错/筛选条件变了 → `pdd_reviews_list` 传 `refreshTemplate:true`
- 运行测试：`npm test`
