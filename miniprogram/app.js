const config = require('./config')

App({
  globalData: {
    scanIntent: null,
    pendingResult: null
  },

  onLaunch() {
    if (wx.cloud && config.cloudEnv) {
      wx.cloud.init({ env: config.cloudEnv, traceUser: true })
      this.cloudReady = true
    } else {
      this.cloudReady = false
    }
  }
})
