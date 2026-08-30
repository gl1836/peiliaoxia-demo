const api = require('../../services/api')
const storage = require('../../services/storage')

const TIPS = [
  '配料表是按含量从高到低排列的',
  '"全麦面包"配料第一位必须是全麦粉',
  '配料表越短，通常加工程度越低',
  '看到"氢化""起酥""植脂末"要警惕反式脂肪',
  '果葡糖浆排在前面，含糖通常不低'
]

Page({
  data: {
    state: 'idle', // idle | preview | analyzing
    previewImg: '',
    tip: TIPS[0]
  },

  onShow() {
    const app = getApp()
    const intent = app.globalData.scanIntent
    if (intent) {
      app.globalData.scanIntent = null
      if (intent === 'barcode') this.startBarcode()
      else if (intent === 'photo') this.pickImage()
    }
  },

  onUnload() {
    this.stopTips()
  },

  startBarcode() {
    wx.scanCode({
      success: res => {
        if (res.result) {
          this.runAnalyze({ barcode: res.result })
        } else {
          wx.showToast({ title: '没扫到条码，试试拍配料表', icon: 'none' })
        }
      },
      fail: () => {}
    })
  },

  pickImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      success: res => {
        const f = res.tempFiles && res.tempFiles[0]
        if (f) this.setData({ state: 'preview', previewImg: f.tempFilePath })
      },
      fail: () => {}
    })
  },

  retake() {
    this.pickImage()
  },

  cancelPreview() {
    this.setData({ state: 'idle', previewImg: '' })
  },

  confirmAnalyze() {
    this.runAnalyze({ image: this.data.previewImg })
  },

  runAnalyze(query) {
    this.setData({ state: 'analyzing' })
    this.startTips()
    const profile = storage.getProfile()
    const task = query.barcode
      ? api.analyzeByBarcode(query.barcode, profile)
      : api.analyzeByImage(query.image, profile)

    task
      .then(result => {
        this.stopTips()
        storage.addHistory(result)
        getApp().globalData.pendingResult = result
        this.setData({ state: 'idle', previewImg: '' })
        wx.navigateTo({ url: '/pages/result/result' })
      })
      .catch(err => {
        this.stopTips()
        this.setData({ state: 'idle', previewImg: '' })
        wx.showToast({
          title: err.message || '分析失败，请重试',
          icon: 'none',
          duration: 2500
        })
      })
  },

  startTips() {
    let i = 0
    this.setData({ tip: TIPS[0] })
    this.stopTips()
    this.tipTimer = setInterval(() => {
      i = (i + 1) % TIPS.length
      this.setData({ tip: TIPS[i] })
    }, 2400)
  },

  stopTips() {
    if (this.tipTimer) {
      clearInterval(this.tipTimer)
      this.tipTimer = null
    }
  }
})
