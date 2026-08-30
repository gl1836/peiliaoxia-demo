// 两级数据闸的晋升逻辑（纯函数，可单测）
// OCR 结果先入候选库（用户级缓存）；同一产品配料哈希被 ≥quorum 个独立扫描
// 确认一致才晋升权威库（另需人工抽检配合），防止 OCR 错误固化成"事实"。

const DEFAULT_QUORUM = 3

function hashIngredients(ingredients) {
  const s = (ingredients || []).join('|')
  let h = 5381
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  }
  return h.toString(36)
}

/**
 * 决定候选记录的写入动作
 * @param {null|{confirmations:number, ingredientsHash:string, status:string}} existing 同 barcode+hash 的既有候选
 * @param {string} incomingHash 本次 OCR 结果的配料哈希
 * @param {number} quorum 晋升权威库所需确认次数
 * @returns {{type:'insert'|'variant'|'increment'|'noop', confirmations:number, promote:boolean}}
 */
function decideCandidateAction(existing, incomingHash, quorum = DEFAULT_QUORUM) {
  if (!existing) {
    return { type: 'insert', confirmations: 1, promote: false }
  }
  if (existing.ingredientsHash !== incomingHash) {
    // 同一条码识别出不同配料：作为另一条候选独立累计，不影响原记录
    return { type: 'variant', confirmations: 1, promote: false }
  }
  if (existing.status !== 'pending') {
    return { type: 'noop', confirmations: existing.confirmations || 1, promote: false }
  }
  const confirmations = (existing.confirmations || 1) + 1
  return {
    type: 'increment',
    confirmations,
    promote: confirmations >= quorum
  }
}

module.exports = { DEFAULT_QUORUM, hashIngredients, decideCandidateAction }
