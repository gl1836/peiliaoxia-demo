const { verdictUI, levelUI } = require('../../utils/verdict')

Page({
  data: {
    r: null,
    ui: null,
    flags: []
  },

  onLoad() {
    const app = getApp()
    const r = app.globalData.pendingResult
    if (!r) {
      wx.switchTab({ url: '/pages/home/home' })
      return
    }
    const ui = verdictUI(r.verdict)
    const rows = (r.ingredients || []).map(i =>
      Object.assign({}, i, { ui: levelUI(i.level) })
    )
    const flags = (r.flags || []).map(f =>
      Object.assign({}, f, { ui: levelUI(f.level) })
    )
    this.setData({
      r: Object.assign({}, r, { ingredients: rows }),
      ui,
      flags
    })
    wx.setNavigationBarColor({
      frontColor: '#ffffff',
      backgroundColor: ui.color
    })
  },

  onUnload() {
    wx.setNavigationBarColor({
      frontColor: '#ffffff',
      backgroundColor: '#2E7D32'
    })
  },

  scanAgain() {
    wx.switchTab({ url: '/pages/scan/scan' })
  },

  goHome() {
    wx.switchTab({ url: '/pages/home/home' })
  },

  onShareAppMessage() {
    const r = this.data.r
    return {
      title: `配料侠说：${r ? r.productName : '这个食品'} —— ${r ? r.verdictText : ''}`,
      path: '/pages/home/home'
    }
  }
})
