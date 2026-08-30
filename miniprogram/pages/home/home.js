const storage = require('../../services/storage')
const profileUtil = require('../../utils/profile')

const TIPS = [
  '配料表是按含量从高到低排列的，排第一的才是主角',
  '"全麦面包"配料第一位必须是全麦粉，否则是伪全麦',
  '配料表越短，通常加工程度越低',
  '果葡糖浆、麦芽糖浆，都是糖的"马甲"',
  '看到"氢化""起酥""植脂末"，孩子最好避开'
]

Page({
  data: {
    hasProfile: false,
    profileSummary: '',
    tip: ''
  },

  onLoad() {
    this.setData({ tip: TIPS[Math.floor(Math.random() * TIPS.length)] })
  },

  onShow() {
    const p = storage.getProfile()
    this.setData({
      hasProfile: storage.hasProfile(),
      profileSummary: profileUtil.summarize(p)
    })
  },

  goBarcode() {
    getApp().globalData.scanIntent = 'barcode'
    wx.switchTab({ url: '/pages/scan/scan' })
  },

  goPhoto() {
    getApp().globalData.scanIntent = 'photo'
    wx.switchTab({ url: '/pages/scan/scan' })
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/profile/profile' })
  }
})
