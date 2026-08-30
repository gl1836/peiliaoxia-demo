// 知识库构建产物测试：保证知识包结构合法、关键条目在位、引擎消费正常
const assert = require('assert')
const kb = require('../cloudfunctions/analyze/rules/kb.additives.json')
const { evaluate } = require('../cloudfunctions/analyze/rules/engine')

// 1. 包结构
assert.ok(kb.version, '知识包应有版本号')
assert.ok(Array.isArray(kb.entries) && kb.entries.length >= 50, `条目数应≥50，实际 ${kb.entries.length}`)

// 2. 必填字段 + 枚举合法
const LEVELS = ['safe', 'notice', 'warning', 'danger']
for (const e of kb.entries) {
  assert.ok(e.id && e.name && e.category && e.explain, `字段缺失: ${e.id || e.name}`)
  assert.ok(LEVELS.includes(e.level), `${e.name} level 非法`)
  if (e.childLevel) assert.ok(LEVELS.includes(e.childLevel), `${e.name} childLevel 非法`)
}

// 3. 别名跨条目冲突检测（与 build-kb 同规则，防止包被手工改坏）
const owner = new Map()
for (const e of kb.entries) {
  for (const t of [e.name, ...(e.aliases || [])]) {
    assert.ok(!owner.has(t) || owner.get(t) === e.id, `别名冲突: 「${t}」`)
    owner.set(t, e.id)
  }
}

// 4. 引擎关键路径（v1 回归等价物）
const ids = kb.entries.map(e => e.id)
;['INS250', 'INS319', 'INS951', 'INS171', 'RISK-MARGARINE', 'RISK-HVO', 'BANNED-SUDAN'].forEach(id => {
  assert.ok(ids.includes(id), `关键条目缺失: ${id}`)
})

// 5. 别名匹配：配料表里写别名/INS 俗名也要命中
const r1 = evaluate(['小麦粉', '植物油', '起酥油'], { role: 'child_3_12' })
assert.ok(r1.ingredientRows.find(r => r.name === '起酥油').level === 'danger', '起酥油儿童应为 danger')

const r2 = evaluate(['水', '白砂糖', '甜蜜素'], { role: 'adult' })
assert.ok(r2.ingredientRows.find(r => r.name === '甜蜜素').level === 'warning', '甜蜜素应为 warning')

const r3 = evaluate(['水', '奶精', '食用香精'], { role: 'adult' })
assert.strictEqual(r3.ingredientRows.find(r => r.name === '奶精').level, 'warning', '奶精（植脂末别名）应命中风险原料')

// 6. 已禁用物质 → 直接 danger 结论
const r4 = evaluate(['面粉', '溴酸钾'], { role: 'adult' })
assert.strictEqual(r4.verdict, 'danger', '检出已禁用物质应直接判 danger')

// 7. 最长别名优先：山梨酸钾 命中 山梨酸钾 而非 山梨酸
const r5 = evaluate(['水', '山梨酸钾'], { role: 'adult' })
const row = r5.ingredientRows.find(r => r.name === '山梨酸钾')
assert.ok(row.level === 'warning', '山梨酸钾应为 warning')

console.log(`✔ 知识库全部通过（${kb.entries.length} 条目，7 组断言）`)
