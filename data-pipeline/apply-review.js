/**
 * 营养师审核结果回写
 * 用法: node data-pipeline/apply-review.js <review-export.json>
 *
 * 把审核后台导出的 review-*.json 合并回 data/additives.kb.json：
 *  - approve → 该条目视为已审定（记录审核人/日期）
 *  - adjust  → 按营养师调整后的 level/childLevel 覆盖，并附注
 * 回写后自动重新执行 build-kb 生成新知识包。
 */
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const KB_PATH = path.join(ROOT, 'data/additives.kb.json')

const reviewFile = process.argv[2]
if (!reviewFile) {
  console.error('用法: node data-pipeline/apply-review.js <review-export.json>')
  process.exit(1)
}

const review = JSON.parse(fs.readFileSync(reviewFile, 'utf-8'))
const kb = JSON.parse(fs.readFileSync(KB_PATH, 'utf-8'))

let applied = 0, adjusted = 0
for (const d of review.decisions || []) {
  const entry = kb.entries.find(e => e.id === d.id)
  if (!entry) { console.warn(`  跳过未知条目: ${d.id}`); continue }
  if (d.decision === 'adjust' || d.adjustedLevel) {
    if (d.adjustedLevel) entry.level = d.adjustedLevel
    if (d.adjustedChildLevel !== undefined) entry.childLevel = d.adjustedChildLevel || null
    if (d.explain) entry.explain = d.explain
    if (d.childExplain) entry.childExplain = d.childExplain
    adjusted++
  }
  entry.reviewedBy = review.reviewer || '未署名'
  entry.reviewedAt = review.reviewedAt
  entry.reviewerNote = d.note || undefined
  entry.confidence = 'high' // 经营养师审定后视为高置信
  applied++
}

fs.writeFileSync(KB_PATH, JSON.stringify(kb, null, 2) + '\n')
console.log(`✔ 已回写 ${applied} 条审核结论（其中调整分级 ${adjusted} 条），审核人: ${review.reviewer || '未署名'}`)

console.log('重新构建知识包...')
execSync('node ' + path.join(__dirname, 'build-kb.js'), { stdio: 'inherit' })
