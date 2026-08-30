/**
 * 评测回归脚本：用黄金评测集量化规则引擎效果
 * 用法: node test/eval.js
 *
 * 指标:
 *   verdictAccuracy  —— 结论等级一致率（标注了 verdict 的样本）
 *   flagRecall       —— 必中风险成分召回率（mustFlag 是否全部触发）
 *   conditionRecall  —— 慢病规则触发率（mustConditionNote 是否返回对应 conditionNotes）
 *   falseDangerRate  —— 误伤率（标注 mustNotDanger 却被判 danger 的比例）
 * 退出码非零 = 评测不达标，禁止上线（可接入 CI）
 */
const path = require('path')
const { evaluate } = require('../cloudfunctions/analyze/rules/engine.js')

const golden = require('./golden/golden-samples.json')

const LEVEL_RANK = { safe: 0, notice: 1, caution: 1, warning: 2, danger: 3 }

let verdictTotal = 0, verdictHit = 0
let flagTotal = 0, flagHit = 0
let condTotal = 0, condHit = 0
let ndTotal = 0, ndViolations = 0
const failures = []

for (const s of golden.samples) {
  const r = evaluate(s.ingredients, s.profile)
  const exp = s.expect || {}

  if (exp.verdict) {
    verdictTotal++
    // verdict 允许同等级或更严一级（知识库扩量后结论可能变严，标注以口径复审为准）
    const ok = r.verdict === exp.verdict
    if (ok) verdictHit++
    else failures.push(`${s.id} ${s.name}: 期望 verdict=${exp.verdict}，实际=${r.verdict}`)
  }

  for (const term of exp.mustFlag || []) {
    flagTotal++
    const hit = r.flags.some(f => (f.name || '').includes(term) || (f.reason || '').includes(term))
      || r.ingredientRows.some(row => row.name.includes(term) && LEVEL_RANK[row.level] >= LEVEL_RANK.warning)
    if (hit) flagHit++
    else failures.push(`${s.id} ${s.name}: mustFlag「${term}」未触发`)
  }

  if (exp.mustConditionNote) {
    condTotal++
    const hit = (r.conditionNotes || []).some(n => (n.source || '').includes(exp.mustConditionNote) || (n.id || '') === exp.mustConditionNote)
    if (hit) condHit++
    else failures.push(`${s.id} ${s.name}: 慢病规则 ${exp.mustConditionNote} 未触发`)
  }

  if (exp.mustNotDanger) {
    ndTotal++
    if (r.verdict === 'danger') {
      ndViolations++
      failures.push(`${s.id} ${s.name}: 误伤为 danger`)
    }
  }
}

const pct = (a, b) => (b ? ((a / b) * 100).toFixed(1) + '%' : '—')
console.log('========== 黄金评测集回归 ==========')
console.log(`样本数:            ${golden.samples.length}`)
console.log(`结论一致率:        ${pct(verdictHit, verdictTotal)} (${verdictHit}/${verdictTotal})`)
console.log(`必中成分召回率:    ${pct(flagHit, flagTotal)} (${flagHit}/${flagTotal})`)
console.log(`慢病规则触发率:    ${pct(condHit, condTotal)} (${condHit}/${condTotal})`)
console.log(`误伤率:            ${pct(ndViolations, ndTotal)} (${ndViolations}/${ndTotal})`)

if (failures.length) {
  console.log('\n失败明细:')
  failures.forEach(f => console.log('  ✘ ' + f))
}

// 上线门槛：必中召回 100%，误伤率 0，结论一致率 ≥80%
const pass = flagHit === flagTotal && ndViolations === 0 && (verdictTotal === 0 || verdictHit / verdictTotal >= 0.8)
console.log(pass ? '\n✔ 评测达标，可以发布' : '\n✘ 评测不达标，禁止发布')
process.exit(pass ? 0 : 1)
