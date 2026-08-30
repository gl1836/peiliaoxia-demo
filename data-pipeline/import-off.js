/**
 * Open Food Facts 中国数据导入管线
 * 用法:
 *   1. 下载 OFF 全量转储（免费、开放数据 ODbL 协议）：
 *      https://world.openfoodfacts.org/data → "MongoDB dump" 或 JSONL 导出
 *      （文件较大，约几 GB；也可用其 API 按 country 分页拉取）
 *   2. node data-pipeline/import-off.js <off-dump.jsonl> <out.jsonl>
 *
 * 产出: 适配云数据库 products 集合的 JSONL（微信云开发控制台可直接导入），
 * 只保留"配料文本完整"的中国在售商品，并给每条打完整度评分，便于人工复核排序。
 * 注意: OFF 中国覆盖有限且字段质量参差，导入后统一走 candidates 晋升流程，
 * 不直接进权威库。
 */
const fs = require('fs')
const readline = require('readline')

const [, , inPath, outPath] = process.argv
if (!inPath || !outPath) {
  console.error('用法: node data-pipeline/import-off.js <off-dump.jsonl> <out.jsonl>')
  process.exit(1)
}

function isChinaProduct(p) {
  const c = (p.countries_tags || []).join(' ').toLowerCase() + ' ' + (p.countries || '')
  return /china|中国|hong.kong|taiwan/.test(c)
}

function extractIngredients(p) {
  const text = p.ingredients_text_zh || p.ingredients_text || ''
  if (!text || text.length < 4) return null
  // 粗切分：中英文逗号/顿号/分号；去掉"配料："前缀与含量括号
  const clean = text.replace(/^(配料|配料表|成分)[:：]/, '').trim()
  const parts = clean.split(/[,，、;；]/)
    .map(s => s.replace(/[()（）].*?[)）]/g, '').trim())
    .filter(s => s && s.length <= 30)
  return parts.length >= 2 ? parts : null
}

function completeness(p, ingredients) {
  let score = 0
  if (ingredients) score += 50
  if (p.product_name_zh || p.product_name) score += 20
  if (p.brands) score += 10
  if (p.nutriments && p.nutriments['energy-kcal_100g'] != null) score += 10
  if (p.image_ingredients_url) score += 10
  return score
}

async function run() {
  const rl = readline.createInterface({ input: fs.createReadStream(inPath), crlfDelay: Infinity })
  const out = fs.createWriteStream(outPath)
  let total = 0, china = 0, kept = 0, skippedNoIngredients = 0

  for await (const line of rl) {
    total++
    let p
    try { p = JSON.parse(line) } catch { continue }
    if (!isChinaProduct(p)) continue
    china++
    const ingredients = extractIngredients(p)
    if (!ingredients) { skippedNoIngredients++; continue }

    const doc = {
      barcode: String(p.code || '').trim(),
      name: (p.product_name_zh || p.product_name || '').trim(),
      brand: (p.brands || '').split(',')[0].trim(),
      ingredients,
      source: 'off',
      status: 'pending', // 一律走候选晋升流程，不直接进权威库
      completeness: completeness(p, ingredients),
      offUrl: `https://world.openfoodfacts.org/product/${p.code}`
    }
    if (!doc.barcode || !doc.name) continue
    out.write(JSON.stringify(doc) + '\n')
    kept++
    if (kept % 1000 === 0) console.log(`  已导出 ${kept} 条...`)
  }

  out.end()
  console.log('────────────────────────')
  console.log(`扫描 ${total} 条 → 中国在售 ${china} 条 → 有配料表 ${kept} 条已导出（${skippedNoIngredients} 条缺配料文本被跳过）`)
  console.log(`→ ${outPath}（按 completeness 排序后分批导入云数据库 candidates 流程）`)
}

run()
