/**
 * 用户纠错回写管线（闭环：用户报错 → 营养师核实 → 回写知识库 → 重新构建）
 *
 * 第一步 分析: node data-pipeline/apply-feedback.js user-feedback.json
 *   把用户在结果页提交的纠错（web/kb.html「用户纠错」页导出）匹配到知识库条目，
 *   生成待裁定补丁模板 data-pipeline/out/feedback-patch.json
 *
 * 第二步 回写: node data-pipeline/apply-feedback.js --apply data-pipeline/out/feedback-patch.json
 *   营养师在补丁模板中填 decision/adjustedLevel/adjustedExplain 后，写回 data/additives.kb.json
 *   回写后需重新运行 build-kb.js + build-web.js 生效
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const KB_PATH = path.join(ROOT, 'data/additives.kb.json')
const OUT_DIR = path.join(ROOT, 'data-pipeline/out')

function loadKb() { return JSON.parse(fs.readFileSync(KB_PATH, 'utf-8')) }

function matchEntry(kb, ingredient) {
  if (!ingredient) return null
  const q = ingredient.trim()
  return kb.entries.find(e =>
    e.name === q || (e.aliases || []).includes(q) || e.name.includes(q) || q.includes(e.name)
  ) || null
}

function analyze(feedbackPath) {
  const fb = JSON.parse(fs.readFileSync(feedbackPath, 'utf-8'))
  const kb = loadKb()
  const items = fb.items || []

  const patchItems = []
  const unmatched = []
  for (const f of items) {
    const entry = matchEntry(kb, f.ingredient)
    if (entry) {
      patchItems.push({
        feedbackTs: f.ts,
        type: f.type,
        ingredient: f.ingredient,
        userNote: f.note || '',
        matchedEntry: { id: entry.id, name: entry.name, level: entry.level, childLevel: entry.childLevel },
        // 营养师填写 ↓
        decision: null,          // adjust | reject
        adjustedLevel: null,     // safe | notice | warning | danger
        adjustedChildLevel: null,
        adjustedExplain: null,
        reviewerNote: ''
      })
    } else if (f.ingredient) {
      unmatched.push({ ts: f.ts, type: f.type, ingredient: f.ingredient, note: f.note || '', ingredients: f.ingredients })
    }
  }

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })
  const patchPath = path.join(OUT_DIR, 'feedback-patch.json')
  fs.writeFileSync(patchPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    source: path.basename(feedbackPath),
    totalFeedback: items.length,
    matched: patchItems.length,
    unmatched: unmatched.length,
    items: patchItems
  }, null, 2))
  fs.writeFileSync(path.join(OUT_DIR, 'feedback-unmatched.json'), JSON.stringify(unmatched, null, 2))

  console.log(`✔ 分析完成: 共 ${items.length} 条纠错，${patchItems.length} 条匹配到知识库条目，${unmatched.length} 条未匹配`)
  console.log(`  补丁模板 → ${patchPath}（营养师填写 decision 后用 --apply 回写）`)
  if (unmatched.length) console.log(`  未匹配成分 → data-pipeline/out/feedback-unmatched.json（可能是新成分，考虑入库）`)
}

function apply(patchPath) {
  const patch = JSON.parse(fs.readFileSync(patchPath, 'utf-8'))
  const kb = loadKb()
  const LEVELS = ['safe', 'notice', 'warning', 'danger']
  let applied = 0, rejected = 0, skipped = 0

  for (const p of patch.items || []) {
    if (!p.decision) { skipped++; continue }
    if (p.decision === 'reject') { rejected++; continue }
    if (p.decision !== 'adjust') { skipped++; continue }
    const entry = kb.entries.find(e => e.id === p.matchedEntry.id)
    if (!entry) { skipped++; continue }
    if (p.adjustedLevel) {
      if (!LEVELS.includes(p.adjustedLevel)) { console.error(`  ✘ ${entry.name}: 非法分级 ${p.adjustedLevel}`); continue }
      entry.level = p.adjustedLevel
    }
    if (p.adjustedChildLevel && LEVELS.includes(p.adjustedChildLevel)) entry.childLevel = p.adjustedChildLevel
    if (p.adjustedExplain) entry.explain = p.adjustedExplain
    entry.reviewedBy = entry.reviewedBy || '营养师审核（用户纠错闭环）'
    entry.reviewedAt = new Date().toISOString().slice(0, 10)
    entry.confidence = 'high'
    applied++
  }

  kb.updatedAt = new Date().toISOString().slice(0, 10)
  fs.writeFileSync(KB_PATH, JSON.stringify(kb, null, 2))
  console.log(`✔ 回写完成: 应用 ${applied} 条 / 驳回 ${rejected} 条 / 跳过未裁定 ${skipped} 条`)
  console.log('  请运行 node data-pipeline/build-kb.js && node data-pipeline/build-web.js 使变更生效')
}

const arg = process.argv[2]
if (arg === '--apply') {
  if (!process.argv[3]) { console.error('用法: node apply-feedback.js --apply <patch.json>'); process.exit(1) }
  apply(process.argv[3])
} else if (arg) {
  analyze(arg)
} else {
  console.error('用法:\n  node apply-feedback.js <user-feedback.json>     分析并生成补丁模板\n  node apply-feedback.js --apply <patch.json>     应用营养师裁定')
  process.exit(1)
}
