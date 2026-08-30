const ROLES = [
  { id: 'adult', label: '成年人' },
  { id: 'child_1_3', label: '宝宝 1-3 岁' },
  { id: 'child_3_12', label: '儿童 3-12 岁' },
  { id: 'pregnant', label: '孕期' }
]

const GOALS = [
  { id: 'fat_loss', label: '减脂控卡' },
  { id: 'sugar_control', label: '控糖' },
  { id: 'salt_control', label: '控盐' },
  { id: 'child_health', label: '儿童健康' }
]

const ALLERGENS = ['牛奶', '鸡蛋', '花生', '坚果', '大豆', '小麦', '海鲜']

// 慢病标签：与 data/disease-rules.kb.json 的 conditions.id 一一对应
const CONDITIONS = [
  { id: 'obesity', label: '肥胖/减重' },
  { id: 'obesity_child', label: '儿童肥胖' },
  { id: 'ckd', label: '慢性肾病' },
  { id: 'hyperuricemia', label: '高尿酸/痛风' }
]

function roleLabel(id) {
  const r = ROLES.find(x => x.id === id)
  return r ? r.label : ROLES[0].label
}

function goalLabel(id) {
  const g = GOALS.find(x => x.id === id)
  return g ? g.label : id
}

function conditionLabel(id) {
  const c = CONDITIONS.find(x => x.id === id)
  return c ? c.label : id
}

function summarize(p) {
  const parts = [roleLabel(p.role)]
  if (p.goals && p.goals.length) {
    parts.push('关注 ' + p.goals.map(goalLabel).join('/'))
  }
  if (p.conditions && p.conditions.length) {
    parts.push('慢病 ' + p.conditions.map(conditionLabel).join('/'))
  }
  if (p.allergens && p.allergens.length) {
    parts.push('过敏 ' + p.allergens.join('/'))
  }
  return parts.join(' · ')
}

module.exports = { ROLES, GOALS, ALLERGENS, CONDITIONS, roleLabel, goalLabel, conditionLabel, summarize }
