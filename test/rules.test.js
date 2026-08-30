// 规则引擎单元测试：node test/rules.test.js
const assert = require('assert')
const { evaluate } = require('../cloudfunctions/analyze/rules/engine')

const adult = { role: 'adult', goals: [], allergens: [] }

// 1. 干净配料 → safe
let r = evaluate(['生牛乳'], adult)
assert.strictEqual(r.verdict, 'safe', '纯牛奶应为 safe')
assert.strictEqual(r.score, 100)

// 2. 命中过敏源 → danger，并给出原因
r = evaluate(['小麦粉', '全脂乳粉', '白砂糖'], { role: 'adult', goals: [], allergens: ['牛奶'] })
assert.strictEqual(r.verdict, 'danger', '过敏源命中应为 danger')
assert.ok(r.flags.some(f => f.reason.includes('牛奶')), 'flags 应指出过敏源')

// 3. 反式脂肪 + 儿童 → danger
r = evaluate(['小麦粉', '白砂糖', '人造奶油', '酵母'], { role: 'child_3_12', goals: [], allergens: [] })
assert.strictEqual(r.verdict, 'danger', '人造奶油对儿童应为 danger')

// 4. 反式脂肪 + 成人 → caution
r = evaluate(['小麦粉', '白砂糖', '人造奶油', '酵母'], adult)
assert.strictEqual(r.verdict, 'caution', '人造奶油对成人应为 caution')

// 5. 糖进前三 + 控糖目标 → danger
r = evaluate(['水', '白砂糖', '果葡糖浆', '柠檬酸'], { role: 'adult', goals: ['sugar_control'], allergens: [] })
assert.strictEqual(r.verdict, 'danger', '控糖人群遇高糖应为 danger')

// 6. 糖进前三 + 普通成人 → caution
r = evaluate(['水', '白砂糖', '柠檬酸'], adult)
assert.strictEqual(r.verdict, 'caution', '糖前三应为 caution')

// 7. 代糖 + 儿童 → caution
r = evaluate(['水', '赤藓糖醇', '二氧化碳'], { role: 'child_3_12', goals: [], allergens: [] })
assert.strictEqual(r.verdict, 'caution', '代糖对儿童应为 caution')

// 8. 16 种干净配料 → 仅提示加工度，不升级结论
const many = ['水', '小麦粉', '燕麦片', '酵母', '食用盐', '鸡蛋', '黄油', '蜂蜜', '奶粉', '芝麻', '葡萄干', '核桃碎', '玉米粒', '紫薯粉', '南瓜粉', '菠菜粉']
r = evaluate(many, adult)
assert.ok(r.flags.some(f => f.level === 'notice'), '超过15种配料应有 notice')
assert.notStrictEqual(r.verdict, 'danger', '干净配料不应为 danger')

// 9. TBHQ + 幼儿 → danger
r = evaluate(['马铃薯', '植物油', '特丁基对苯二酚'], { role: 'child_1_3', goals: [], allergens: [] })
assert.strictEqual(r.verdict, 'danger', 'TBHQ 对幼儿应为 danger')

// 10. 孕期 + 亚硝酸盐 → danger
r = evaluate(['猪肉', '亚硝酸钠', '食用盐'], { role: 'pregnant', goals: [], allergens: [] })
assert.strictEqual(r.verdict, 'danger', '亚硝酸盐对孕期应为 danger')

// 11. 控盐目标 + 盐进前五 → warning flag
r = evaluate(['水', '面粉', '食用盐', '酵母'], { role: 'adult', goals: ['salt_control'], allergens: [] })
assert.ok(r.flags.some(f => f.reason.includes('控盐')), '控盐规则应触发')

// 12. 肥胖档案 + 可乐 → 触发减重规则并返回 conditionNotes
r = evaluate(['水', '白砂糖', '二氧化碳'], { role: 'adult', goals: [], allergens: [], conditions: ['obesity'] })
assert.ok(r.conditionNotes && r.conditionNotes.length === 1, '应返回肥胖 conditionNotes')
assert.ok(r.conditionNotes[0].source.includes('成人肥胖'), '应标注指南来源')

// 13. 肥胖档案 + 油炸配料 → warning flag 带指南原因
r = evaluate(['马铃薯', '植物油', '油炸方便面饼', '食用盐'], { role: 'adult', goals: [], allergens: [], conditions: ['obesity'] })
assert.ok(r.flags.some(f => f.reason.includes('减重')), '肥胖规则应命中油炸')

// 14. 肾病档案 + 磷酸盐 → warning
r = evaluate(['水', '鸡肉', '三聚磷酸钠', '食用盐'], { role: 'adult', goals: [], allergens: [], conditions: ['ckd'] })
assert.ok(r.flags.some(f => f.reason.includes('磷')), '肾病规则应命中含磷添加剂')

// 15. 高尿酸档案 + 啤酒 → danger；+ 高嘌呤食物 → warning
r = evaluate(['水', '啤酒', '麦芽'], { role: 'adult', goals: [], allergens: [], conditions: ['hyperuricemia'] })
assert.ok(r.flags.some(f => f.level === 'danger' && f.reason.includes('尿酸')), '痛风人群遇酒精应为 danger')
r = evaluate(['鲅鱼', '食盐', '姜'], { role: 'adult', goals: [], allergens: [], conditions: ['hyperuricemia'] })
assert.ok(r.flags.some(f => f.reason.includes('高嘌呤')), '嘌呤库应命中鲅鱼')

// 16. 儿童肥胖规则不误伤成人；成人规则不误伤儿童
r = evaluate(['水', '可乐'], { role: 'child_3_12', goals: [], allergens: [], conditions: ['obesity'] })
assert.ok(!r.conditionNotes.length, '成人肥胖规则不应用于儿童')
r = evaluate(['水', '可乐'], { role: 'child_3_12', goals: [], allergens: [], conditions: ['obesity_child'] })
assert.ok(r.conditionNotes.length === 1, '儿童肥胖规则应命中儿童角色')

// 17. 慢病命中应同步升级成分行分级
r = evaluate(['水', '啤酒'], { role: 'adult', goals: [], allergens: [], conditions: ['hyperuricemia'] })
const beerRow = r.ingredientRows.find(x => x.name === '啤酒')
assert.strictEqual(beerRow.level, 'danger', '啤酒成分行应升级为 danger')

console.log('✔ 规则引擎全部 17 个用例通过')
