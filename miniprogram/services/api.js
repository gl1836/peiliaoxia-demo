const config = require('../config')

const ANALYZE_TIMEOUT = 20000

function callAnalyze(payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('分析超时，请重试')), ANALYZE_TIMEOUT)
    wx.cloud.callFunction({
      name: config.analyzeFunction,
      data: payload,
      success: res => {
        clearTimeout(timer)
        const r = res.result || {}
        if (r.ok) {
          resolve(r.data)
        } else {
          reject(new Error(r.message || '分析失败，请重试'))
        }
      },
      fail: err => {
        clearTimeout(timer)
        reject(new Error(err.errMsg || '网络异常，请重试'))
      }
    })
  })
}

function analyzeByBarcode(barcode, profile) {
  if (!getApp().cloudReady) return mockAnalyze('barcode')
  return callAnalyze({ barcode, profile })
}

function analyzeByImage(tempFilePath, profile) {
  if (!getApp().cloudReady) return mockAnalyze('image')
  return new Promise((resolve, reject) => {
    wx.cloud.uploadFile({
      cloudPath: `scans/${Date.now()}-${Math.floor(Math.random() * 1e4)}.jpg`,
      filePath: tempFilePath,
      success: up => {
        callAnalyze({ imageFileID: up.fileID, profile }).then(resolve, reject)
      },
      fail: () => reject(new Error('图片上传失败，请重试'))
    })
  })
}

// 演示模式：未配置云环境时，用内置数据走通完整 UI 流程
function mockAnalyze(source) {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve({
        source,
        productName: '某品牌 全麦软面包',
        brand: '示例品牌',
        barcode: source === 'barcode' ? '6901234567890' : '',
        verdict: 'caution',
        verdictText: '不算差，但"全麦"有水分，糖也偏多，减脂和孩子都悠着点。',
        score: 62,
        ingredients: [
          { name: '小麦粉', level: 'notice', explanation: '排第一的是小麦粉而不是全麦粉，"全麦"含量存疑' },
          { name: '全麦粉', level: 'safe', explanation: '真材实料，但排位靠后说明加得不多' },
          { name: '白砂糖', level: 'warning', explanation: '排在第三位，糖加得不少，控糖人群注意' },
          { name: '植物油', level: 'safe', explanation: '普通食用油，正常' },
          { name: '人造奶油', level: 'danger', explanation: '可能含反式脂肪酸，孩子最好不要碰' },
          { name: '酵母', level: 'safe', explanation: '发酵用，正常' },
          { name: '山梨酸钾', level: 'warning', explanation: '常见防腐剂，合规使用安全，但能少则少' },
          { name: '食用盐', level: 'safe', explanation: '正常' }
        ],
        flags: [
          { name: '人造奶油', level: 'danger', reason: '反式脂肪酸风险，儿童尽量避开' },
          { name: '白砂糖', level: 'warning', reason: '糖排在配料表前三位，含糖量不低' },
          { name: '山梨酸钾', level: 'warning', reason: '防腐剂，孩子能少则少' }
        ],
        alternatives: [
          { brand: '桃李', product: '醇熟全麦切片面包', reason: '全麦粉排第一位，没有人造奶油' },
          { brand: '宾堡', product: '自然全麦面包', reason: '配料表短，糖和油都更克制' }
        ],
        tip: '挑全麦面包先看配料表第一位是不是"全麦粉"，再看有没有"人造奶油、起酥油"。',
        demo: true
      })
    }, 1600)
  })
}

module.exports = { analyzeByBarcode, analyzeByImage }
