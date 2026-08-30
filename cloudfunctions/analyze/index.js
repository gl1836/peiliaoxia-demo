// 配料侠分析主云函数
// 流程：条码 → 查产品库（命中秒回）→ 未命中提示拍照
//       照片 → VLM OCR 提取配料 → 规则引擎判断 → LLM 大白话表达 → 回写产品库
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const engine = require('./rules/engine')
const promotion = require('./rules/promotion')
const llm = require('./llm')

const ok = data => ({ ok: true, data })
const fail = (message, code) => ({ ok: false, message, code })

exports.main = async event => {
  try {
    const { barcode, imageFileID } = event || {}
    const profile = sanitizeProfile(event && event.profile)
    if (barcode) return await handleBarcode(String(barcode).trim(), profile)
    if (imageFileID) return await handleImage(imageFileID, profile)
    return fail('缺少条码或图片参数', 'BAD_REQUEST')
  } catch (e) {
    console.error('analyze error', e)
    return fail('分析服务开小差了，请重试', 'INTERNAL')
  }
}

function sanitizeProfile(p) {
  const base = { role: 'adult', goals: [], allergens: [], conditions: [] }
  if (!p || typeof p !== 'object') return base
  return {
    role: typeof p.role === 'string' ? p.role : 'adult',
    goals: Array.isArray(p.goals) ? p.goals : [],
    allergens: Array.isArray(p.allergens) ? p.allergens : [],
    conditions: Array.isArray(p.conditions) ? p.conditions : []
  }
}

async function handleBarcode(barcode, profile) {
  const res = await db
    .collection('products')
    .where({ barcode })
    .limit(1)
    .get()

  // 只服务权威数据（verified / 种子）；pending 候选不对用户输出
  const product = (res.data || []).find(p => p.status !== 'pending')
  if (!product) {
    return fail('产品库暂未收录这个条码，试试拍配料表', 'PRODUCT_NOT_FOUND')
  }
  const data = await buildResult(product, profile, 'database')
  return ok(data)
}

async function handleImage(imageFileID, profile) {
  const file = await cloud.downloadFile({ fileID: imageFileID })
  const base64 = file.fileContent.toString('base64')

  // 未配置模型 Key：返回 Mock，保证链路可演示
  if (!llm.hasKey()) {
    return ok(mockResult(profile))
  }

  const ocr = await llm.ocrIngredients(base64)
  if (!ocr || ocr.error || !Array.isArray(ocr.ingredients) || !ocr.ingredients.length) {
    return fail('没认出配料表，请靠近一点、拍清楚文字再试', 'OCR_FAILED')
  }

  const product = {
    productName: ocr.productName || '未命名食品',
    brand: ocr.brand || '',
    barcode: ocr.barcode || '',
    ingredients: ocr.ingredients
  }
  const data = await buildResult(product, profile, 'ocr')

  // OCR 结果只进候选库；达到法定票数才晋升权威库（两级数据闸）
  saveCandidate(product).catch(e => console.warn('saveCandidate warn', e))

  return ok(data)
}

async function buildResult(product, profile, source) {
  const evaluated = engine.evaluate(product.ingredients || [], profile)

  // 表达层：LLM 生成大白话；失败则使用规则引擎的模板文案兜底
  let expr = null
  try {
    expr = await llm.express({
      productName: product.productName,
      verdict: evaluated.verdict,
      score: evaluated.score,
      flags: evaluated.flags,
      profile
    })
  } catch (e) {
    console.warn('express fallback', e)
  }

  return {
    source,
    productName: product.productName || '未命名食品',
    brand: product.brand || '',
    barcode: product.barcode || '',
    verdict: evaluated.verdict,
    verdictText: (expr && expr.verdictText) || evaluated.verdictText,
    score: evaluated.score,
    ingredients: evaluated.ingredientRows,
    flags: evaluated.flags,
    conditionNotes: evaluated.conditionNotes || [],
    alternatives: expr && Array.isArray(expr.alternatives) ? expr.alternatives : [],
    tip: (expr && expr.tip) || '配料表越短，通常加工程度越低。',
    disclaimer: '结果仅供参考，不构成医疗建议；过敏信息请以包装标示为准'
  }
}

// 候选库：同条码同配料哈希累计确认次数；≥quorum 个独立扫描一致才晋升权威库
async function saveCandidate(product) {
  if (!product.barcode) return
  const ingredientsHash = promotion.hashIngredients(product.ingredients)
  const col = db.collection('product_candidates')
  const exist = await col
    .where({ barcode: product.barcode, ingredientsHash })
    .limit(1)
    .get()
  const existing = exist.data && exist.data[0]
  const action = promotion.decideCandidateAction(existing, ingredientsHash)

  if (action.type === 'noop') return

  if (action.type === 'insert' || action.type === 'variant') {
    await col.add({
      data: {
        barcode: product.barcode,
        productName: product.productName,
        brand: product.brand,
        ingredients: product.ingredients,
        ingredientsHash,
        confirmations: 1,
        status: 'pending',
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    })
    return
  }

  await col.doc(existing._id).update({
    data: { confirmations: action.confirmations, updatedAt: db.serverDate() }
  })
  if (action.promote) {
    await promoteCandidate(existing._id, product, ingredientsHash)
  }
}

async function promoteCandidate(candidateId, product, ingredientsHash) {
  const col = db.collection('product_candidates')
  const products = db.collection('products')
  const existing = await products.where({ barcode: product.barcode }).limit(1).get()
  const verified = (existing.data || []).find(p => p.status !== 'pending')

  if (!verified) {
    await products.add({
      data: {
        barcode: product.barcode,
        productName: product.productName,
        brand: product.brand,
        ingredients: product.ingredients,
        ingredientsHash,
        status: 'verified',
        source: 'crowd_verified',
        createdAt: db.serverDate()
      }
    })
    await col.doc(candidateId).update({
      data: { status: 'promoted', updatedAt: db.serverDate() }
    })
    return
  }

  // 已有权威数据：哈希一致直接标记；不一致则进人工复核队列（营养师抽检）
  const same = !verified.ingredientsHash || verified.ingredientsHash === ingredientsHash
  await col.doc(candidateId).update({
    data: { status: same ? 'promoted' : 'conflict_review', updatedAt: db.serverDate() }
  })
}

function mockResult(profile) {
  const ingredients = ['小麦粉', '全麦粉', '白砂糖', '植物油', '人造奶油', '酵母', '山梨酸钾', '食用盐']
  const evaluated = engine.evaluate(ingredients, profile)
  return {
    source: 'mock',
    productName: '某品牌 全麦软面包',
    brand: '示例品牌',
    barcode: '6901234567890',
    verdict: evaluated.verdict,
    verdictText: evaluated.verdictText,
    score: evaluated.score,
    ingredients: evaluated.ingredientRows,
    flags: evaluated.flags,
    conditionNotes: evaluated.conditionNotes || [],
    alternatives: [
      { brand: '桃李', product: '醇熟全麦切片面包', reason: '全麦粉排第一，没有人造奶油' },
      { brand: '宾堡', product: '自然全麦面包', reason: '配料表更短，糖和油更克制' }
    ],
    tip: '挑全麦面包先看配料第一位是不是"全麦粉"。',
    demo: true,
    disclaimer: '结果仅供参考，不构成医疗建议；过敏信息请以包装标示为准'
  }
}
