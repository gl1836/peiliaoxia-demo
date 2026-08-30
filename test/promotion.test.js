// 候选库晋升逻辑单元测试：node test/promotion.test.js
const assert = require('assert')
const { hashIngredients, decideCandidateAction } = require('../cloudfunctions/analyze/rules/promotion')

const h1 = hashIngredients(['小麦粉', '白砂糖', '酵母'])
assert.strictEqual(h1, hashIngredients(['小麦粉', '白砂糖', '酵母']), '相同配料哈希应稳定')
assert.notStrictEqual(h1, hashIngredients(['小麦粉', '白糖', '酵母']), '不同配料哈希应不同')

// 1. 首次识别 → insert
let a = decideCandidateAction(null, h1)
assert.strictEqual(a.type, 'insert')
assert.strictEqual(a.promote, false)

// 2. 第二次一致 → increment，未达票数不晋升
let a2 = decideCandidateAction({ confirmations: 1, ingredientsHash: h1, status: 'pending' }, h1)
assert.strictEqual(a2.type, 'increment')
assert.strictEqual(a2.confirmations, 2)
assert.strictEqual(a2.promote, false)

// 3. 第三次一致 → 达到法定票数，晋升
let a3 = decideCandidateAction({ confirmations: 2, ingredientsHash: h1, status: 'pending' }, h1)
assert.strictEqual(a3.promote, true)

// 4. 已晋升/复核后 → noop，避免重复写权威库
let a4 = decideCandidateAction({ confirmations: 3, ingredientsHash: h1, status: 'promoted' }, h1)
assert.strictEqual(a4.type, 'noop')

// 5. 同条码不同配料 → variant，独立累计不影响原候选
let a5 = decideCandidateAction({ confirmations: 2, ingredientsHash: 'zzz', status: 'pending' }, h1)
assert.strictEqual(a5.type, 'variant')
assert.strictEqual(a5.promote, false)

console.log('✔ 候选库晋升逻辑全部 6 个用例通过')
