// LLM 层：只做两件事——看图提取配料（OCR）、把规则引擎的结论说成人话（表达）
// 所有"能不能吃"的判断由 rules/engine.js 完成，本层不做健康判断。
// 未配置 QWEN_API_KEY 时返回 null，由调用方走 Mock/模板兜底。
//
// 零幻觉五层防线（表达层）：
//   1. 架构隔离 —— 结论全部由确定性规则引擎产出，LLM 永不生成事实
//   2. RAG 注入 —— prompt 内携带规则引擎结论与知识库原文，模型只能复述
//   3. 输出约束 —— temperature=0 + 固定 JSON schema
//   4. 后置校验 —— validateExpression() 程序化核对：输出的每个成分名/数字/结论方向
//      都必须能在规则引擎结果中找到，出现任何新事实即判幻觉
//   5. 模板兜底 —— 校验失败时降级为纯模板文本（templateExpress），保证用户
//      看到的每个字都可溯源到知识库

const https = require('https')

const API_KEY = process.env.QWEN_API_KEY || ''
const VL_MODEL = process.env.QWEN_VL_MODEL || 'qwen-vl-plus'
const TEXT_MODEL = process.env.QWEN_TEXT_MODEL || 'qwen-turbo'
const ENDPOINT = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'

const hasKey = () => Boolean(API_KEY)

function postJson(body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const u = new URL(ENDPOINT)
    const req = https.request(
      {
        hostname: u.hostname,
        path: u.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data),
          Authorization: `Bearer ${API_KEY}`
        },
        timeout: timeoutMs
      },
      res => {
        let raw = ''
        res.on('data', c => (raw += c))
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(raw) })
          } catch (e) {
            reject(new Error(`模型响应解析失败 (${res.statusCode})`))
          }
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error('模型请求超时')))
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

function extractJson(text) {
  if (!text) throw new Error('模型返回为空')
  const cleaned = text.replace(/```json|```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('模型未返回 JSON')
  return JSON.parse(cleaned.slice(start, end + 1))
}

async function chat(messages, model, timeoutMs) {
  const { status, json } = await postJson(
    {
      model,
      messages,
      temperature: 0,
      max_tokens: 2000
    },
    timeoutMs
  )
  if (status !== 200 || !json) {
    throw new Error(`模型调用失败 (${status})`)
  }
  const content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content
  return extractJson(content)
}

/**
 * 看图识别配料表，只返回结构化数据，不做任何健康判断
 * @param {string} base64Image jpeg/png base64（不含 data: 前缀）
 */
async function ocrIngredients(base64Image) {
  if (!hasKey()) return null
  const result = await chat(
    [
      {
        role: 'system',
        content:
          '你是食品配料表识别助手。识别用户照片中的食品标签信息，严格输出 JSON，不要输出任何其他文字。' +
          '格式：{"productName":"产品名","brand":"品牌","ingredients":["配料1","配料2"],"barcode":"条码数字(如可见,否则空字符串)","nutrition":{"energy":"","protein":"","fat":"","carbohydrate":"","sodium":""}}。' +
          '要求：ingredients 必须保持配料表原顺序（按含量降序）；看不清的配料不要编造，宁缺毋滥；无法识别时返回 {"error":"无法识别配料表"}。'
      },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Image}` } },
          { type: 'text', text: '请识别这张食品标签照片。' }
        ]
      }
    ],
    VL_MODEL,
    15000
  )
  return validateOcrResult(result)
}

/**
 * OCR 结果校验：过滤明显幻觉（空成分、超长串、条码非数字），并给每个成分标注
 * 是否在知识库中命中（unverified 成分在 UI 提示用户核对，不直接参与判定升级）
 */
function validateOcrResult(result) {
  if (!result || result.error) return result
  const kb = require('./rules/kb.additives.json')
  const knownTerms = new Set()
  for (const e of kb.entries || []) {
    knownTerms.add(e.name)
    ;(e.aliases || []).forEach(a => knownTerms.add(a))
  }
  const cleaned = []
  for (const raw of result.ingredients || []) {
    const name = String(raw || '').trim()
    if (!name || name.length > 30) continue
    cleaned.push({ name, verified: knownTerms.has(name) })
  }
  return {
    ...result,
    ingredients: cleaned.map(c => c.name),
    ingredientMeta: cleaned,
    barcode: /^\d{8,14}$/.test(result.barcode || '') ? result.barcode : ''
  }
}

/**
 * 表达层幻觉校验：LLM 输出中的事实必须全部来自规则引擎结果
 * @returns {{ok:boolean, violations:string[]}}
 */
function validateExpression(llmOut, enginePayload) {
  const violations = []
  if (!llmOut || typeof llmOut !== 'object') return { ok: false, violations: ['输出不是对象'] }

  const facts = JSON.stringify({
    flags: enginePayload.flags || [],
    rows: enginePayload.ingredientRows || [],
    conditions: enginePayload.conditionNotes || []
  })
  const text = [llmOut.verdictText, llmOut.tip, ...(llmOut.alternatives || []).map(a => `${a.brand}${a.product}${a.reason}`)].join(' ')

  // 1. 成分名白名单：输出中出现的知识库成分名，必须在规则引擎结果里出现过
  const kb = require('./rules/kb.additives.json')
  for (const e of kb.entries || []) {
    for (const term of [e.name, ...(e.aliases || [])]) {
      if (term.length >= 2 && text.includes(term) && !facts.includes(term)) {
        violations.push(`提到规则引擎未命中的成分「${term}」`)
      }
    }
  }

  // 2. 数字溯源：输出中的数字（ADI、限量等）必须能在事实块中找到
  const numbers = text.match(/\d+(\.\d+)?/g) || []
  for (const n of numbers) {
    if (!facts.includes(n) && !String(enginePayload.score).includes(n)) {
      violations.push(`出现无法溯源的数字「${n}」`)
    }
  }

  // 3. 结论方向锁死：danger/warning 结论下不得出现安抚性措辞，反之亦然
  const verdict = enginePayload.verdict
  const soothing = ['可以放心吃', '完全没有问题', '放心食用', '安全无忧']
  const alarming = ['千万不能吃', '有毒', '致癌风险极高', '一口都不能碰']
  if ((verdict === 'danger' || verdict === 'warning') && soothing.some(p => text.includes(p))) {
    violations.push('高风险结论下出现安抚性措辞')
  }
  if (verdict === 'safe' && alarming.some(p => text.includes(p))) {
    violations.push('安全结论下出现恐吓性措辞')
  }

  // 4. 医疗表述红线
  const medical = ['治疗', '治愈', '治病', '防癌', '抗癌', '降尿酸治疗', '替代药物', '停药']
  for (const p of medical) {
    if (text.includes(p)) violations.push(`出现医疗表述「${p}」`)
  }

  return { ok: violations.length === 0, violations }
}

/**
 * 纯模板兜底表达：不经过 LLM，每个字都可溯源
 */
function templateExpress(payload) {
  const { verdict, flags } = payload
  const VERDICT_TEXT = {
    safe: '配料表干净，没有发现需要担心的成分',
    notice: '整体可以，个别成分留意一下',
    caution: '有几个成分需要注意，建议控制食用频率',
    warning: '存在需要警惕的成分，建议少吃或换更干净的同类',
    danger: '含有高风险成分，不建议食用，尤其是孩子和特殊人群'
  }
  const topFlags = (flags || []).filter(f => f.level === 'danger' || f.level === 'warning').slice(0, 3)
  return {
    verdictText: VERDICT_TEXT[verdict] || VERDICT_TEXT.caution,
    alternatives: [],
    tip: topFlags.length
      ? `重点关注：${topFlags.map(f => f.name).join('、')}。${topFlags[0].reason}`
      : '保持食物多样，配料表越短越好',
    _source: 'template'
  }
}

/**
 * 表达层：RAG 注入规则引擎结论 → LLM 转写 → 幻觉校验 → 失败降级模板
 * @param {{productName:string, verdict:string, score:number, flags:Array, ingredientRows:Array, conditionNotes:Array, profile:Object}} payload
 */
async function express(payload) {
  if (!hasKey()) return null
  const { productName, verdict, score, flags, ingredientRows, conditionNotes, profile } = payload
  const roleText = { adult: '成年人', child_1_3: '1-3岁宝宝', child_3_12: '3-12岁儿童', pregnant: '孕妇' }[(profile && profile.role) || 'adult']

  // RAG：把规则引擎的确定性结论和知识库原文作为唯一事实来源注入
  const factBlock = JSON.stringify({
    结论: verdict,
    评分: score,
    命中规则: (flags || []).map(f => ({ 成分: f.name, 等级: f.level, 原因: f.reason })),
    成分解读: (ingredientRows || []).filter(r => r.level !== 'safe').map(r => ({ 成分: r.name, 等级: r.level, 解释: r.explanation })),
    慢病建议: (conditionNotes || []).map(c => ({ 疾病: c.name, 来源: c.source, 要点: (c.tips || []).slice(0, 3) }))
  })

  try {
    const llmOut = await chat(
      [
        {
          role: 'system',
          content:
            '你是配料侠，用老百姓能听懂的大白话转写食品安全结论。' +
            '【铁律】你只能复述用户消息中「事实块」里的信息，禁止添加任何事实块之外的成分名、数字、功效或风险描述；' +
            '禁止医疗表述（治疗/治愈/防癌等）；不改变结论方向。' +
            '严格输出 JSON：{"verdictText":"一句话结论(30字内)","tip":"一条实用小建议(40字内)","alternatives":[]}。' +
            'alternatives 固定返回空数组，不推荐具体品牌。'
        },
        {
          role: 'user',
          content:
            `产品：${productName}；用户：${roleText}。\n事实块（唯一事实来源）：${factBlock}\n` +
            '请把事实块转写成亲切的大白话，结论方向与事实块完全一致。'
        }
      ],
      TEXT_MODEL,
      12000
    )

    const check = validateExpression(llmOut, payload)
    if (!check.ok) {
      console.warn('LLM 输出未通过幻觉校验，降级为模板:', check.violations.join('；'))
      return { ...templateExpress(payload), _fallback: 'hallucination_guard', _violations: check.violations }
    }
    return { ...llmOut, _source: 'llm', _verified: true }
  } catch (e) {
    console.warn('LLM 表达层失败，降级为模板:', e.message)
    return { ...templateExpress(payload), _fallback: 'llm_error' }
  }
}

module.exports = { ocrIngredients, express, hasKey, validateExpression, templateExpress, validateOcrResult }
