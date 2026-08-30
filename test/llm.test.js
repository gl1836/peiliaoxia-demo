// 零幻觉校验器测试：validateExpression / templateExpress / validateOcrResult
const assert = require('assert')
const { validateExpression, templateExpress, validateOcrResult } = require('../cloudfunctions/analyze/llm.js')

const payload = {
  productName: '某辣条',
  verdict: 'danger',
  score: 32,
  flags: [{ name: '特丁基对苯二酚', level: 'danger', reason: '儿童应避免' }],
  ingredientRows: [
    { name: '小麦粉', level: 'safe' },
    { name: '特丁基对苯二酚', level: 'danger', explanation: '抗氧化剂，儿童应避免' }
  ],
  conditionNotes: [],
  profile: { role: 'child_3_12' }
}

// 1. 干净输出通过校验
let r = validateExpression(
  { verdictText: '含有特丁基对苯二酚，孩子别吃', tip: '换配料更干净的同类零食', alternatives: [] },
  payload
)
assert.ok(r.ok, '干净输出应通过: ' + r.violations.join(';'))

// 2. 提到规则引擎未命中的成分 → 拦截
r = validateExpression(
  { verdictText: '还含有苏丹红，千万别吃', tip: '', alternatives: [] },
  payload
)
assert.ok(!r.ok && r.violations.some(v => v.includes('苏丹红')), '编造成分应被拦截')

// 3. 出现无法溯源的数字 → 拦截
r = validateExpression(
  { verdictText: '特丁基对苯二酚每日限量 0.2mg', tip: '', alternatives: [] },
  payload
)
assert.ok(!r.ok && r.violations.some(v => v.includes('0.2')), '编造数字应被拦截')

// 4. 高危结论下安抚性措辞 → 拦截
r = validateExpression(
  { verdictText: '可以放心吃，完全没有问题', tip: '', alternatives: [] },
  payload
)
assert.ok(!r.ok && r.violations.some(v => v.includes('安抚')), '结论方向篡改编造应被拦截')

// 5. 医疗表述 → 拦截
r = validateExpression(
  { verdictText: '特丁基对苯二酚需要注意', tip: '坚持吃能治疗营养不良', alternatives: [] },
  payload
)
assert.ok(!r.ok && r.violations.some(v => v.includes('医疗')), '医疗表述应被拦截')

// 6. 模板兜底：不经过 LLM，结构完整且结论方向一致
const t = templateExpress(payload)
assert.ok(t.verdictText && t.tip, '模板应返回完整结构')
assert.ok(t.tip.includes('特丁基对苯二酚'), '模板 tip 应引用规则引擎命中项')
assert.deepStrictEqual(t.alternatives, [], '模板不推荐品牌')

// 7. OCR 结果校验：过滤空串/超长串，条码非数字置空，成分标注 verified
const ocr = validateOcrResult({
  productName: '测试',
  ingredients: ['水', '植脂末', '', 'x'.repeat(40), '未知成分XYZ'],
  barcode: 'abc123',
  nutrition: {}
})
assert.deepStrictEqual(ocr.ingredients, ['水', '植脂末', '未知成分XYZ'], '应过滤空串与超长串')
assert.strictEqual(ocr.barcode, '', '非数字条码应置空')
const meta = Object.fromEntries(ocr.ingredientMeta.map(m => [m.name, m.verified]))
assert.strictEqual(meta['植脂末'], true, '知识库成分应标 verified')
assert.strictEqual(meta['未知成分XYZ'], false, '未知成分应标 unverified')

console.log('✔ 零幻觉校验器全部 7 个用例通过')
