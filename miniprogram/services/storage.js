const PROFILE_KEY = 'plx_profile'
const HISTORY_KEY = 'plx_history'
const HISTORY_CAP = 50

const EMPTY_PROFILE = {
  role: 'adult',
  goals: [],
  allergens: []
}

function getProfile() {
  try {
    const p = wx.getStorageSync(PROFILE_KEY)
    if (p && typeof p === 'object') {
      return Object.assign({}, EMPTY_PROFILE, p)
    }
  } catch (e) {}
  return Object.assign({}, EMPTY_PROFILE)
}

function hasProfile() {
  const p = getProfile()
  return p.role !== 'adult' || p.goals.length > 0 || p.allergens.length > 0
}

function saveProfile(profile) {
  wx.setStorageSync(PROFILE_KEY, profile)
}

function getHistory() {
  try {
    const h = wx.getStorageSync(HISTORY_KEY)
    return Array.isArray(h) ? h : []
  } catch (e) {
    return []
  }
}

function addHistory(result) {
  const list = getHistory()
  list.unshift({
    id: 'h' + Date.now(),
    time: Date.now(),
    productName: result.productName || '未命名食品',
    verdict: result.verdict,
    verdictText: result.verdictText,
    result
  })
  if (list.length > HISTORY_CAP) list.length = HISTORY_CAP
  wx.setStorageSync(HISTORY_KEY, list)
}

function clearHistory() {
  wx.removeStorageSync(HISTORY_KEY)
}

module.exports = {
  EMPTY_PROFILE,
  getProfile,
  hasProfile,
  saveProfile,
  getHistory,
  addHistory,
  clearHistory
}
