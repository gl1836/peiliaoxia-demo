// 规则引擎 v2：输入配料数组 + 用户健康档案，输出确定性判断
// 设计原则：所有"能不能吃"的判断都在这里发生，可解释、可单测、可审计；
// LLM 只负责把这些结论说成人话（见 ../llm.js）。
// v2 变化：风险成分判定改为消费结构化知识包 kb.additives.json（由 data-pipeline/build-kb.js
// 从 data/additives.kb.json 构建，经营养师审定），支持别名/INS 编号匹配与逐条目分级。

// 双环境加载：Node 用 require；浏览器用 window 全局（web/kb-bundle.js 注入）
const _isNode = typeof module !== 'undefined' && module.exports
const { ALLERGENS, SUGARS, SALTS } = _isNode ? require('./data') : window.RuleData
const kb = _isNode ? require('./kb.additives.json') : window.AdditivesKB
const _emptyDisease = { conditions: [] }
const _emptyPurine = { entries: [] }
const diseaseKb = _isNode
  ? require('./disease-rules.json')
  : (window.DiseaseRulesKB || _emptyDisease)
const purineKb = _isNode
  ? require('./purine.json')
  : (window.PurineKB || _emptyPurine)

// 构建词项索引：主名 + 别名，按长度降序，保证"山梨酸钾"优先于"山梨酸"命中
const TERM_INDEX = []
kb.entries.forEach(entry => {
  ;[entry.name, ...(entry.aliases || [])].forEach(term => {
    if (term) TERM_INDEX.push({ term, entry })
  })
})
TERM_INDEX.sort((a, b) => b.term.length - a.term.length)

const isChildRole = role => role === 'child_1_3' || role === 'child_3_12'

// 嘌呤索引：去掉括号注释（如"鲅鱼(烤)"→"鲅鱼"），按长度降序避免短词抢匹配
const PURINE_INDEX = (purineKb.entries || [])
  .map(e => ({ term: String(e.name || '').replace(/[（(].*$/, ''), entry: e }))
  .filter(x => x.term.length >= 2)
  .sort((a, b) => b.term.length - a.term.length)

function matchRiskEntry(ingredient) {
  const hit = TERM_INDEX.find(x => ingredient.includes(x.term))
  return hit ? hit.entry : null
}

function matchPurineEntry(ingredient) {
  const hit = PURINE_INDEX.find(x => ingredient.includes(x.term))
  return hit ? hit.entry : null
}

function findAllergenHits(ingredients, allergens) {
  const hits = []
  for (const a of allergens || []) {
    const terms = ALLERGENS[a]
    if (!terms) continue
    const ing = ingredients.find(x => terms.some(t => x.includes(t)))
    if (ing) hits.push({ allergen: a, ingredient: ing })
  }
  return hits
}

function findFirstIndex(ingredients, terms) {
  return ingredients.findIndex(ing => terms.some(t => ing.includes(t)))
}

/**
 * @param {string[]} ingredients 配料表（按含量降序）
 * @param {{role?:string, goals?:string[], allergens?:string[]}} profile
 * @returns {{verdict:string, score:number, flags:Array, ingredientRows:Array, verdictText:string}}
 */
function evaluate(ingredients, profile) {
  const p = Object.assign({ role: 'adult', goals: [], allergens: [] }, profile || {})
  const strict = isChildRole(p.role) || p.role === 'pregnant' || p.goals.includes('child_health')

  const flags = []
  const ingredientRows = []

  // 1. 过敏原：最高优先级，命中即 danger
  const allergenHits = findAllergenHits(ingredients, p.allergens)

  // 2. 逐行判定
  ingredients.forEach(ing => {
    let level = 'safe'
    let explanation = ''
    let fun = ''

    const allergenHit = allergenHits.find(h => h.ingredient === ing)
    if (allergenHit) {
      level = 'danger'
      explanation = `你登记的过敏源「${allergenHit.allergen}」就在这个成分里，别碰`
    } else {
      const entry = matchRiskEntry(ing)
      if (entry) {
        level = strict && entry.childLevel ? entry.childLevel : entry.level
        explanation = strict && entry.childExplain ? entry.childExplain : entry.explain
        fun = entry.funExplain || ''
      }
    }
    const row = { name: ing, level, explanation }
    if (fun) row.fun = fun
    ingredientRows.push(row)
  })

  // 3. 汇总 flags
  allergenHits.forEach(h => {
    flags.push({
      name: h.ingredient,
      level: 'danger',
      reason: `含你的过敏源「${h.allergen}」`,
      weight: 60
    })
  })
  ingredientRows.forEach(r => {
    if (r.level === 'safe') return
    if (allergenHits.some(h => h.ingredient === r.name)) return
    flags.push({
      name: r.name,
      level: r.level,
      reason: r.explanation,
      weight: r.level === 'danger' ? 35 : r.level === 'warning' ? 12 : 5
    })
  })

  // 4. 糖位置规则：前三位有糖 → 含糖偏高
  const sugarIdx = findFirstIndex(ingredients, SUGARS)
  if (sugarIdx >= 0 && sugarIdx <= 2) {
    const sugarControl = p.goals.includes('sugar_control')
    flags.push({
      name: ingredients[sugarIdx],
      level: sugarControl ? 'danger' : 'warning',
      reason: sugarControl
        ? '糖排在配料表前三位，你在控糖，这款不建议'
        : '糖排在配料表前三位，含糖量不低',
      weight: sugarControl ? 35 : 15
    })
  }

  // 5. 控盐规则：钠来源进前五 → 提示
  if (p.goals.includes('salt_control')) {
    const saltIdx = findFirstIndex(ingredients, SALTS)
    if (saltIdx >= 0 && saltIdx <= 4) {
      flags.push({
        name: ingredients[saltIdx],
        level: 'warning',
        reason: '钠来源排得靠前，控盐人群悠着点',
        weight: 12
      })
    }
  }

  // 6. 加工度规则
  if (ingredients.length > 15) {
    flags.push({
      name: '配料种类',
      level: 'notice',
      reason: `共 ${ingredients.length} 种配料，加工程度偏高`,
      weight: 8
    })
  }

  // 7. 慢病饮食规则：按健康档案 conditions 触发（卫健委 4 项食养指南结构化）
  const SEVERITY = { safe: 0, notice: 1, warning: 2, danger: 3 }
  const conditionNotes = []
  const conditions = Array.isArray(p.conditions) ? p.conditions : []
  for (const cid of conditions) {
    const cond = (diseaseKb.conditions || []).find(c => c.id === cid)
    if (!cond) continue
    if (cond.appliesTo && cond.appliesTo.length && !cond.appliesTo.includes(p.role)) continue

    ingredients.forEach(ing => {
      cond.flags.forEach(f => {
        if (!f.terms.some(t => ing.includes(t))) return
        flags.push({
          name: ing,
          level: f.level,
          reason: `【${cond.name}】${f.reason}`,
          weight: f.level === 'danger' ? 30 : f.level === 'warning' ? 12 : 5
        })
      })
      // 高尿酸：接嘌呤知识库（236 条，来自痛风食养指南）
      if (cid === 'hyperuricemia') {
        const pe = matchPurineEntry(ing)
        if (pe && pe.class === 1) {
          flags.push({
            name: ing,
            level: 'warning',
            reason: `【${cond.name}】高嘌呤食物（${pe.purineMgPer100g}mg/100g），痛风人群避免`,
            weight: 15
          })
        } else if (pe && pe.class === 2) {
          flags.push({
            name: ing,
            level: 'notice',
            reason: `【${cond.name}】中嘌呤食物（${pe.purineMgPer100g}mg/100g），限量`,
            weight: 5
          })
        }
      }
    })

    conditionNotes.push({
      id: cond.id,
      name: cond.name,
      source: cond.source,
      tips: cond.tips || [],
      nutrientLimits: cond.nutrientLimits || {}
    })
  }

  // 慢病规则命中的配料，同步升级对应成分行的分级与解释（保持 UI 一致）
  flags.forEach(f => {
    const row = ingredientRows.find(r => r.name === f.name)
    if (row && SEVERITY[f.level] > SEVERITY[row.level]) {
      row.level = f.level
      row.explanation = f.reason
    }
  })

  // 8. 评分与结论
  let score = 100
  flags.forEach(f => { score -= f.weight || 10 })
  score = Math.max(0, Math.min(100, score))

  let verdict = 'safe'
  if (flags.some(f => f.level === 'danger')) verdict = 'danger'
  else if (flags.some(f => f.level === 'warning') || score < 85) verdict = 'caution'

  const verdictText = buildVerdictText(verdict, flags, allergenHits)

  // flags 输出前去掉内部权重字段，并按 名称+原因 去重（慢病规则可能与成分规则重复命中）
  const seen = new Set()
  const outFlags = []
  flags.forEach(({ name, level, reason }) => {
    const key = `${name}|${reason}`
    if (seen.has(key)) return
    seen.add(key)
    outFlags.push({ name, level, reason })
  })

  return { verdict, score, flags: outFlags, ingredientRows, verdictText, conditionNotes }
}

function buildVerdictText(verdict, flags, allergenHits) {
  if (verdict === 'danger') {
    if (allergenHits.length) {
      return `含你的过敏源「${allergenHits[0].allergen}」，别买`
    }
    const hard = flags.find(f => f.level === 'danger')
    return hard ? `${hard.name}是硬伤，这款不建议` : '有硬伤，这款不建议'
  }
  if (verdict === 'caution') {
    const top = flags
      .filter(f => f.level === 'warning')
      .slice(0, 2)
      .map(f => f.name)
    return top.length ? `能吃但有讲究：${top.join('、')}要注意` : '整体还行，但别多吃'
  }
  return '配料表干净，放心吃'
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { evaluate }
} else if (typeof window !== 'undefined') {
  window.RuleEngine = { evaluate }
}
