// LLM 层：只做两件事——看图提取配料（OCR）、把规则引擎的结论说成人话（表达）
// 所有"能不能吃"的判断由 rules/engine.js 完成，本层不做健康判断。
// 未配置 QWEN_API_KEY 时返回 null，由调用方走 Mock/模板兜底。

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
      temperature: 0.2,
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
  return chat(
    [
      {
        role: 'system',
        content:
          '你是食品配料表识别助手。识别用户照片中的食品标签信息，严格输出 JSON，不要输出任何其他文字。' +
          '格式：{"productName":"产品名","brand":"品牌","ingredients":["配料1","配料2"],"barcode":"条码数字(如可见,否则空字符串)","nutrition":{"energy":"","protein":"","fat":"","carbohydrate":"","sodium":""}}。' +
          '要求：ingredients 必须保持配料表原顺序（按含量降序）；看不清的配料不要编造；无法识别时返回 {"error":"无法识别配料表"}。'
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
}

/**
 * 表达层：把规则引擎的确定性结论转写成大白话
 * @param {{productName:string, verdict:string, score:number, flags:Array, profile:Object}} payload
 */
async function express(payload) {
  if (!hasKey()) return null
  const { productName, verdict, score, flags, profile } = payload
  const roleText = { adult: '成年人', child_1_3: '1-3岁宝宝', child_3_12: '3-12岁儿童', pregnant: '孕妇' }[(profile && profile.role) || 'adult']
  return chat(
    [
      {
        role: 'system',
        content:
          '你是配料侠，一个拥有15年食品品质管理经验的专家，用老百姓能听懂的大白话说话。' +
          '专业但不端着，直接但不冷漠，替用户着想。不要编造配料表中不存在的信息，不要给出医疗诊断。' +
          '严格输出 JSON：{"verdictText":"一句话结论(30字内)","alternatives":[{"brand":"品牌","product":"产品名","reason":"推荐理由(20字内)"}],"tip":"一条实用小建议(40字内)"}。' +
          'alternatives 最多2条，必须是市面上真实存在、配料确实更好的同类产品；不确定就返回空数组。'
      },
      {
        role: 'user',
        content:
          `产品：${productName}；规则引擎结论：${verdict}（评分${score}）；` +
          `命中规则：${(flags || []).map(f => `${f.name}(${f.reason})`).join('；') || '无'}；` +
          `用户：${roleText}${profile && profile.goals && profile.goals.length ? '，关注' + profile.goals.join('/') : ''}。` +
          '请基于以上确定性结论生成大白话解读，不要改变结论方向。'
      }
    ],
    TEXT_MODEL,
    12000
  )
}

module.exports = { ocrIngredients, express, hasKey }
