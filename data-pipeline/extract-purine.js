/**
 * 嘌呤知识库提取管线
 * 用法: node data-pipeline/extract-purine.js
 *
 * 输入: data/sources/gaoniao-shiyang-2024.txt
 *   —— 国家卫健委《成人高尿酸血症与痛风食养指南（2024年版）》全文
 *      （官方公开发布，允许引用；嘌呤数据本身引自《中国食物成分表》第6版第二册）
 * 输出: data/purine.kb.json —— 痛风/高尿酸人群食物选择规则的知识库
 *
 * 提取策略：PDF 文本表格被拆散，列内"名字打包 + 数值打包"的块无法可靠对齐，
 * 因此只接受严格交替的「名称-数值」相邻对（前后不同时出现连续名称或连续数值），
 * 保证零错配；无法对齐的条目放弃，宁缺毋滥。输出整体标记为待营养师抽检。
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const SRC = path.join(ROOT, 'data/sources/gaoniao-shiyang-2024.txt')
const OUT = path.join(ROOT, 'data/purine.kb.json')

function classify(mg) {
  if (mg >= 150) return { class: 1, label: '高嘌呤（150-1000mg/100g），痛风人群避免' }
  if (mg >= 75) return { class: 2, label: '较高嘌呤（75-150mg/100g），严格限量' }
  if (mg >= 30) return { class: 3, label: '较低嘌呤（30-75mg/100g），适量' }
  return { class: 4, label: '低嘌呤（<30mg/100g），可放心选择' }
}

function extract() {
  const text = fs.readFileSync(SRC, 'utf-8')
  const startM = text.match(/表\s*1-2\s*常见食物嘌呤含量表/)
  if (!startM) {
    console.error('✘ 未找到附录 1 表格区域，请检查源文件')
    process.exit(1)
  }
  const after = text.slice(startM.index)
  const endM = after.match(/#*\s*附录\s*2/)
  const region = endM ? after.slice(0, endM.index) : after

  // 分词：按空白与 markdown 表格符切开
  const rawTokens = region.split(/[\s|]+/).filter(t => t && t !== '---' && !/^(单位|mg\/100g|（单位：mg\/100g）)$/.test(t))

  // 浮点小数（如 3.5 度米醋）粘到后一个名称上
  const tokens = []
  for (let i = 0; i < rawTokens.length; i++) {
    const t = rawTokens[i]
    if (/^\d+\.\d+$/.test(t) && i + 1 < rawTokens.length) {
      tokens.push(t + rawTokens[i + 1])
      i++
    } else {
      tokens.push(t)
    }
  }

  const isNum = t => /^\d{1,3}$/.test(t)
  const isName = t => /[一-龥]/.test(t) && !isNum(t)

  const entries = []
  const seen = new Map()
  let skippedPairs = 0

  for (let i = 0; i < tokens.length - 1; i++) {
    const name = tokens[i]
    const val = tokens[i + 1]
    if (!isName(name) || !isNum(val)) continue

    const prev = i > 0 ? tokens[i - 1] : null
    const next = i + 2 < tokens.length ? tokens[i + 2] : null
    // 高置信规则：前面是数字/开头（排除名字链），后面是名字/结尾（排除数字链）
    const prevOk = !prev || isNum(prev)
    const nextOk = !next || isName(next)
    if (!prevOk || !nextOk) { skippedPairs++; continue }

    const mg = parseInt(val, 10)
    if (mg > 1000) { skippedPairs++; continue }
    const clean = name.replace(/\[.*?$/g, '').replace(/[(\（].*$/, m => m).trim()
    if (!clean || seen.has(clean)) continue
    seen.set(clean, true)
    entries.push({ name: clean, purineMgPer100g: mg, ...classify(mg) })
  }

  entries.sort((a, b) => b.purineMgPer100g - a.purineMgPer100g)

  const kb = {
    version: '2026.08.04-1',
    meta: {
      source: '国家卫健委《成人高尿酸血症与痛风食养指南（2024年版）》附录 1（数据本身引自《中国食物成分表》第6版第二册）',
      thresholds: '四类分级：高 ≥150 / 较高 75-150 / 较低 30-75 / 低 <30（mg/100g），按指南原文',
      quality: 'auto_extracted_needs_spotcheck（自动提取，需营养师抽检核对后转正式）'
    },
    entries
  }
  fs.writeFileSync(OUT, JSON.stringify(kb, null, 2) + '\n')

  const byClass = [1, 2, 3, 4].map(c => `第${c}类×${entries.filter(e => e.class === c).length}`).join(' / ')
  console.log(`✔ 嘌呤知识库提取完成: ${entries.length} 条（${byClass}）→ data/purine.kb.json`)
  console.log(`  跳过无法可靠对齐的候选对 ${skippedPairs} 个（宁缺毋滥）`)
  console.log('  高嘌呤 TOP5: ' + entries.slice(0, 5).map(e => `${e.name}(${e.purineMgPer100g})`).join('、'))
}

extract()
