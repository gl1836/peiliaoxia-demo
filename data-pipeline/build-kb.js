/**
 * 知识库构建管线
 * 用法: node data-pipeline/build-kb.js
 *
 * 输入: data/additives.kb.json（人工/营养师维护的主库）
 * 输出:
 *   cloudfunctions/analyze/rules/kb.additives.json  —— 规则引擎运行时知识包
 *   data-pipeline/out/review-items.json             —— 营养师待审清单
 *   tools/review/review.build.html                  —— 注入数据后的审核后台页
 *
 * 校验: 必填字段 / 分级枚举 / 别名跨条目冲突 / 重复 id
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const KB_PATH = path.join(ROOT, 'data/additives.kb.json')
const PACK_PATH = path.join(ROOT, 'cloudfunctions/analyze/rules/kb.additives.json')
const OUT_DIR = path.join(ROOT, 'data-pipeline/out')
const REVIEW_JSON_PATH = path.join(OUT_DIR, 'review-items.json')
const REVIEW_HTML_TEMPLATE = path.join(ROOT, 'tools/review/index.html')
const REVIEW_HTML_OUT = path.join(ROOT, 'tools/review/review.build.html')

const LEVELS = ['safe', 'notice', 'warning', 'danger']

function fail(msg) {
  console.error('✘ 构建失败: ' + msg)
  process.exit(1)
}

function validate(kb) {
  const errors = []
  const seenIds = new Set()
  const aliasOwner = new Map() // alias -> entryId

  for (const e of kb.entries || []) {
    if (!e.id || !e.name) errors.push(`条目缺少 id/name: ${JSON.stringify(e).slice(0, 60)}`)
    if (seenIds.has(e.id)) errors.push(`重复 id: ${e.id}`)
    seenIds.add(e.id)
    if (!LEVELS.includes(e.level)) errors.push(`${e.name}: level 非法 (${e.level})`)
    if (e.childLevel != null && !LEVELS.includes(e.childLevel)) errors.push(`${e.name}: childLevel 非法 (${e.childLevel})`)
    if (!e.explain) errors.push(`${e.name}: 缺少 explain（大白话解释必填）`)
    if (!e.category) errors.push(`${e.name}: 缺少 category`)

    const terms = [e.name, ...(e.aliases || [])]
    for (const t of terms) {
      const key = t.trim()
      if (!key) continue
      const owner = aliasOwner.get(key)
      if (owner && owner !== e.id) {
        errors.push(`别名冲突: 「${key}」同时属于 ${owner} 和 ${e.id}（会导致匹配歧义）`)
      }
      aliasOwner.set(key, e.id)
    }
  }
  return errors
}

// 待审规则: warning/danger 级、儿童分级与成人不同、置信度非 high 的条目需要营养师审定
function needsReview(e) {
  const reasons = []
  if (e.level === 'warning' || e.level === 'danger') reasons.push(`成人分级为 ${e.level}`)
  if (e.childLevel && e.childLevel !== e.level) reasons.push(`儿童分级更严 (${e.childLevel})`)
  if (e.confidence !== 'high') reasons.push(`置信度 ${e.confidence}`)
  return reasons
}

function buildReviewItems(kb) {
  return (kb.entries || [])
    .map(e => ({
      id: e.id,
      name: e.name,
      aliases: e.aliases || [],
      ins: e.ins,
      category: e.category,
      func: e.func || '',
      level: e.level,
      childLevel: e.childLevel,
      explain: e.explain,
      childExplain: e.childExplain || '',
      sources: e.sources || [],
      confidence: e.confidence,
      reviewReasons: needsReview(e),
      // 审核结果占位（营养师在页面上填写后导出）
      decision: null, // approve | upgrade | downgrade
      adjustedLevel: null,
      adjustedChildLevel: null,
      reviewerNote: ''
    }))
    .filter(item => item.reviewReasons.length > 0)
}

function build() {
  const kb = JSON.parse(fs.readFileSync(KB_PATH, 'utf-8'))
  const errors = validate(kb)
  if (errors.length) {
    errors.forEach(e => console.error('  - ' + e))
    fail(`共 ${errors.length} 处校验错误`)
  }

  // 与上一版知识包 diff（如有）
  let diffInfo = ''
  if (fs.existsSync(PACK_PATH)) {
    const prev = JSON.parse(fs.readFileSync(PACK_PATH, 'utf-8'))
    const prevIds = new Set(prev.entries.map(e => e.id))
    const nextIds = new Set(kb.entries.map(e => e.id))
    const added = kb.entries.filter(e => !prevIds.has(e.id)).map(e => e.name)
    const removed = prev.entries.filter(e => !nextIds.has(e.id)).map(e => e.name)
    const changed = kb.entries.filter(e => {
      const p = prev.entries.find(x => x.id === e.id)
      return p && JSON.stringify(p) !== JSON.stringify({ ...e, reviewedBy: p.reviewedBy, reviewedAt: p.reviewedAt })
    }).map(e => e.name)
    if (added.length || removed.length || changed.length) {
      diffInfo = `\n变更: +${added.length} 新增 / -${removed.length} 移除 / ~${changed.length} 修改`
      if (added.length) console.log('  新增: ' + added.join('、'))
      if (removed.length) console.log('  移除: ' + removed.join('、'))
      if (changed.length) console.log('  修改: ' + changed.join('、'))
    }
  }

  // 1. 运行时知识包
  const pack = {
    version: kb.version,
    generatedAt: new Date().toISOString(),
    count: kb.entries.length,
    entries: kb.entries
  }
  fs.writeFileSync(PACK_PATH, JSON.stringify(pack, null, 2))

  // 1b. 慢病饮食规则 + 嘌呤知识库 → 云函数运行时目录（单一事实源在 data/）
  const diseaseSrc = path.join(ROOT, 'data/disease-rules.kb.json')
  const purineSrc = path.join(ROOT, 'data/purine.kb.json')
  const disease = JSON.parse(fs.readFileSync(diseaseSrc, 'utf-8'))
  const purine = JSON.parse(fs.readFileSync(purineSrc, 'utf-8'))
  fs.writeFileSync(
    path.join(ROOT, 'cloudfunctions/analyze/rules/disease-rules.json'),
    JSON.stringify(disease, null, 2)
  )
  fs.writeFileSync(
    path.join(ROOT, 'cloudfunctions/analyze/rules/purine.json'),
    JSON.stringify(purine, null, 2)
  )
  console.log(`✔ 慢病规则 ${disease.conditions.length} 组 / 嘌呤 ${purine.entries.length} 条 → 云函数运行时目录`)

  // 2. 待审清单
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })
  const reviewItems = buildReviewItems(kb)
  fs.writeFileSync(REVIEW_JSON_PATH, JSON.stringify({
    version: kb.version,
    generatedAt: new Date().toISOString(),
    totalEntries: kb.entries.length,
    pendingCount: reviewItems.length,
    items: reviewItems
  }, null, 2))

  // 3. 审核页已合并到 web/kb.html 统一列表；保留跳转页兼容旧链接
  const redirect = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8">
<meta http-equiv="refresh" content="0;url=/web/kb.html?status=pending">
<script>location.replace('/web/kb.html?status=pending')</script>
<title>跳转中</title></head>
<body style="font-family:sans-serif;padding:40px;text-align:center;color:#666">
营养师审核已合并到统一知识库列表。<a href="/web/kb.html?status=pending">点此进入</a>
</body></html>`
  fs.writeFileSync(REVIEW_HTML_OUT, redirect)
  fs.writeFileSync(REVIEW_HTML_TEMPLATE, redirect)

  const byCat = {}
  kb.entries.forEach(e => { byCat[e.category] = (byCat[e.category] || 0) + 1 })
  console.log(`✔ 知识包构建完成: v${kb.version}，共 ${kb.entries.length} 条`)
  console.log('  分类分布: ' + Object.entries(byCat).map(([k, v]) => `${k}×${v}`).join(' / '))
  console.log(`✔ 营养师待审清单: ${reviewItems.length} 条 → data-pipeline/out/review-items.json`)
  console.log(`✔ 统一知识库页 → web/kb.html（列表 + 筛选 + 详情底部营养师操作）` + diffInfo)
}

build()
