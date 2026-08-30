# 配料侠 · 帮你读懂每一口

微信小程序 MVP：扫商品条码 / 拍配料表照片，结合你的健康档案，秒级告诉你
能不能吃、为什么、该换什么。

## 架构

```
拍照 / 扫码
   ├─ 条码 → 云数据库产品库（命中秒回，零 AI 成本）
   └─ 照片 → 云函数 analyze
              ├─ 通义 Qwen-VL 看图提取配料（只提取，不判断）
              ├─ 规则引擎 v2 做判断（结构化知识库，GB 2760 / GB 7718 / GB 28050）
              ├─ LLM 表达层把结论说成人话（失败时模板兜底）
              └─ 两级数据闸：候选库 →（≥3 次一致 + 抽检）→ 权威产品库
```

- 前端：原生微信小程序（`miniprogram/`），零依赖；拍照 OCR 为主路径，扫码为渐进优化
- 后端：微信云开发云函数（`cloudfunctions/analyze`），无需自建服务器和备案域名
- 数据：`products`（权威库，仅 verified）+ `product_candidates`（候选库，投票累计中）；
  健康档案仅存用户本机（PIPL 敏感信息最小化）

## 目录

```
miniprogram/            小程序前端
  pages/                home / scan / result / profile / history
  services/             api.js（云调用 + 演示 Mock）、storage.js（本地档案/历史）
  utils/                verdict.js（结论 UI 映射）、profile.js（档案选项）
cloudfunctions/analyze/ 分析云函数
  rules/data.js         过敏原/糖/盐词表
  rules/engine.js       规则引擎 v2（消费知识包，纯函数，可单测）
  rules/kb.additives.json  运行时知识包（由 build-kb 生成，勿手改）
  rules/promotion.js    两级数据闸晋升逻辑（纯函数，可单测）
  llm.js                Qwen-VL OCR + 表达层（零幻觉五层防线：架构隔离/RAG注入/输出约束/后置校验/模板兜底）
data/additives.kb.json  风险成分知识库主库（217 条 = 66 条人工审定高频 + CFSA 官方库全量扩量）
data/purine.kb.json     食物嘌呤知识库（233 条，源自卫健委痛风食养指南 2024）
data/disease-rules.kb.json  慢病饮食规则库（8 组，源自卫健委 8 项食养指南 2023+2024）
data/sources/           指南原文存档（PDF/TXT）+ CFSA 官方添加剂快照，可追溯
data/top-sku-draft.json  TOP 5000 SKU 录入优先级清单草案
data-pipeline/          数据管线
  build-kb.js           知识库构建：校验 → 知识包 + 待审清单 + 慢病/嘌呤运行时拷贝
  expand-additives.js   CFSA 官方库全量扩量（括号配平解析又名/包括/简称，幂等合并）
  enrich-additives.js   条目增强：ADI + 国际状态 + 生动解读（幂等）
  apply-review.js       营养师审核结果回写主库
  apply-feedback.js     用户纠错闭环：分析纠错 → 生成补丁 → 营养师裁定 → 回写主库
  import-off.js         Open Food Facts 中国数据 → candidates JSONL
  extract-purine.js     痛风指南 → 嘌呤知识库提取
  build-web.js          网页资源包构建（添加剂 + 嘌呤 + 慢病规则）
tools/review/           旧审核页入口（已重定向到 web/kb.html）
seed/products.seed.jsonl  产品库种子数据（5 条示例）
test/                   rules / promotion / kb / llm 单元测试 + golden 黄金评测集 + eval.js 评测回归
```

## 网页演示版（手机可试用）

```bash
node data-pipeline/build-web.js          # 生成 web/kb-bundle.js
python3 -m http.server 8123 --bind 0.0.0.0   # 项目根目录起服务
# 手机与电脑连同一 Wi-Fi，浏览器打开 http://<电脑局域网IP>:8123/web/
```

- `web/index.html`：完整用户流程演示（拍照→样本→分析→结果/档案/历史），
  规则引擎在浏览器真实运行，结论随健康档案实时变化；OCR 以样本商品演示；
  档案支持 8 组慢病标签（卫健委 2023+2024 全部食养指南），触发对应食养规则；
  结果页底部可提交纠错（识别错/分级错/解释错/漏成分），进入审核队列
- `web/kb.html`：统一知识库列表（添加剂 + 嘌呤 + 慢病食养规则 + 用户纠错四个板块；
  顶部筛选状态/等级/类别；详情页展示 ADI/国际状态/生动解读；
  底部营养师可编辑分级与解读，导出后用 apply-review.js 回写主库；
  用户纠错页可导出 JSON，用 apply-feedback.js 分析回写）
- 旧审核页 `tools/review/` 已重定向到 `web/kb.html?status=pending`

## 本地跑起来（5 分钟，无需任何配置）

1. 微信开发者工具 → 导入项目根目录
2. `miniprogram/config.js` 中 `cloudEnv` 留空 → 自动进入**演示模式**，
   用内置 Mock 数据走通「拍照 → 分析中 → 结果页 → 历史」完整流程

## 接入真实环境

1. **开通云开发**：开发者工具 → 云开发 → 创建环境，把环境 ID 填入
   `miniprogram/config.js` 的 `cloudEnv`；`project.config.json` 的 `appid`
   换成自己小程序的 AppID
2. **建数据库**：云开发控制台 → 数据库 → 新建集合 `products` 与 `product_candidates`；
   向 `products` 导入 `seed/products.seed.jsonl`（选"每行一个 JSON"）
3. **部署云函数**：右键 `cloudfunctions/analyze` → 上传并部署（云端安装依赖）
4. **配置模型 Key**（阿里云百炼 dashscope）：
   云函数 `analyze` → 配置 → 环境变量：
   - `QWEN_API_KEY`：百炼 API Key（必填，不配则云函数返回 Mock）
   - `QWEN_VL_MODEL`：默认 `qwen-vl-plus`
   - `QWEN_TEXT_MODEL`：默认 `qwen-turbo`

## 测试

```bash
node test/rules.test.js      # 规则引擎 21 个用例（含 8 组慢病规则/嘌呤联动）
node test/promotion.test.js  # 候选库晋升逻辑 6 个用例
node test/kb.test.js         # 知识库结构与关键条目 7 组断言
node test/llm.test.js        # 零幻觉校验器 7 个用例（编造成分/数字/结论方向/医疗表述拦截）
node test/eval.js            # 黄金评测集回归：结论一致率/必中召回/慢病触发/误伤率，不达标退出码非零
```

## 知识库迭代流程（每月）

```bash
# 1. 编辑 data/additives.kb.json（新增条目 / 调整分级）
# 2. 构建：校验 + 生成知识包 + 生成营养师待审清单与审核页
node data-pipeline/build-kb.js
# 3. 把 tools/review/review.build.html 发给营养师（浏览器直接打开，无需部署）
#    营养师逐条「通过 / 调整分级 + 备注」→ 导出 review-*.json 发回
# 4. 回写审核结论并自动重建知识包
node data-pipeline/apply-review.js review-2026.08.04-1.json
# 5. 回归测试后重新部署云函数
node test/rules.test.js && node test/kb.test.js
```

## 产品库冷启动数据管线

```bash
# OFF 开放数据（免费，ODbL 协议）：下载全量 JSONL 转储后过滤中国在售商品
node data-pipeline/import-off.js off-dump.jsonl seed/off-china.jsonl
# 产出按完整度打分，导入云数据库时一律走 candidates 晋升流程，不直接进权威库
# 人工/众包录入优先级见 data/top-sku-draft.json（儿童食品与过敏高发品类优先）
```

## 已实现 / 路线图

- [x] 首页 / 扫一扫（拍照主路径+条码）/ 分析中动画 / 结果页 / 健康档案 / 历史记录
- [x] 条码查权威库秒回 + OCR 管线 + 规则引擎 v2 + LLM 表达兜底
- [x] 两级数据闸：候选库投票晋升权威库，防 OCR 错误固化
- [x] 慢病饮食规则引擎：卫健委 4 项食养指南（2024）结构化，按健康档案触发
- [x] 嘌呤知识库 236 条接入引擎（高尿酸档案自动命中高/中嘌呤配料）
- [x] 66 条添加剂补齐 ADI / 国际状态 / 生动解读（funExplain）
- [ ] 数据冷启动：TOP 5000 高频 SKU 人工/众包建库（酸奶/面包/饮料做深）
- [ ] 扫码未命中 → 拍配料表引导动线（动画提示）
- [ ] 订阅付费（备案完成后开售，预计 M4-6；P1 完全免费；注意 iOS 虚拟支付政策）
- [ ] 分享卡片生成（Canvas 合成，带品牌水印）
- [ ] 替代品推荐的产品库支撑（当前由 LLM 生成，需落到真实 SKU）
- [ ] P0 新鲜度识别技术验证（独立 spike，见方案画布）

## 上线前合规清单（详见方案画布）

小程序备案（工信部）、微信支付商户号、算法备案 + 大模型登记（调用已备案
模型走简化登记，周期 4-6 个月，第一周就提交）、用户协议与隐私政策、
分析结果"仅供参考"免责声明（已内置结果页）。
