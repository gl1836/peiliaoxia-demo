const VERDICT_UI = {
  safe: {
    color: '#2E7D32',
    bg: '#E8F5E9',
    emoji: '🟢',
    label: '放心吃'
  },
  caution: {
    color: '#EF6C00',
    bg: '#FFF3E0',
    emoji: '🟡',
    label: '悠着点'
  },
  danger: {
    color: '#D32F2F',
    bg: '#FFEBEE',
    emoji: '🔴',
    label: '建议避开'
  }
}

const LEVEL_UI = {
  safe: { color: '#2E7D32', label: '安心' },
  notice: { color: '#8A948A', label: '了解' },
  warning: { color: '#EF6C00', label: '注意' },
  danger: { color: '#D32F2F', label: '风险' }
}

function verdictUI(verdict) {
  return VERDICT_UI[verdict] || VERDICT_UI.caution
}

function levelUI(level) {
  return LEVEL_UI[level] || LEVEL_UI.safe
}

module.exports = { VERDICT_UI, LEVEL_UI, verdictUI, levelUI }
