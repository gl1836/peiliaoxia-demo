const storage = require('../../services/storage')
const profileUtil = require('../../utils/profile')

Page({
  data: {
    roles: profileUtil.ROLES,
    goals: profileUtil.GOALS,
    conditions: profileUtil.CONDITIONS,
    allergenOptions: profileUtil.ALLERGENS,
    role: 'adult',
    selectedGoals: {},
    selectedConditions: {},
    selectedAllergens: {}
  },

  onLoad() {
    const p = storage.getProfile()
    const selectedGoals = {}
    const selectedConditions = {}
    const selectedAllergens = {}
    ;(p.goals || []).forEach(g => { selectedGoals[g] = true })
    ;(p.conditions || []).forEach(c => { selectedConditions[c] = true })
    ;(p.allergens || []).forEach(a => { selectedAllergens[a] = true })
    this.setData({ role: p.role, selectedGoals, selectedConditions, selectedAllergens })
  },

  pickRole(e) {
    this.setData({ role: e.currentTarget.dataset.id })
  },

  toggleGoal(e) {
    const id = e.currentTarget.dataset.id
    const key = `selectedGoals.${id}`
    this.setData({ [key]: !this.data.selectedGoals[id] })
  },

  toggleCondition(e) {
    const id = e.currentTarget.dataset.id
    const key = `selectedConditions.${id}`
    this.setData({ [key]: !this.data.selectedConditions[id] })
  },

  toggleAllergen(e) {
    const id = e.currentTarget.dataset.id
    const key = `selectedAllergens.${id}`
    this.setData({ [key]: !this.data.selectedAllergens[id] })
  },

  save() {
    const goals = Object.keys(this.data.selectedGoals).filter(k => this.data.selectedGoals[k])
    const conditions = Object.keys(this.data.selectedConditions).filter(k => this.data.selectedConditions[k])
    const allergens = Object.keys(this.data.selectedAllergens).filter(k => this.data.selectedAllergens[k])
    storage.saveProfile({
      role: this.data.role,
      goals,
      conditions,
      allergens
    })
    wx.showToast({ title: '已保存', icon: 'success' })
    setTimeout(() => wx.navigateBack(), 600)
  }
})
