const storage = require('../../services/storage')
const { verdictUI } = require('../../utils/verdict')

function fmtTime(ts) {
  const d = new Date(ts)
  const pad = n => (n < 10 ? '0' + n : '' + n)
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

Page({
  data: {
    list: []
  },

  onShow() {
    const list = storage.getHistory().map(item =>
      Object.assign({}, item, {
        ui: verdictUI(item.verdict),
        timeText: fmtTime(item.time)
      })
    )
    this.setData({ list })
  },

  openItem(e) {
    const id = e.currentTarget.dataset.id
    const item = storage.getHistory().find(x => x.id === id)
    if (!item) return
    getApp().globalData.pendingResult = item.result
    wx.navigateTo({ url: '/pages/result/result' })
  },

  clearAll() {
    wx.showModal({
      title: '清空历史',
      content: '确定清空所有扫描记录吗？',
      confirmColor: '#D32F2F',
      success: res => {
        if (res.confirm) {
          storage.clearHistory()
          this.setData({ list: [] })
        }
      }
    })
  }
})
