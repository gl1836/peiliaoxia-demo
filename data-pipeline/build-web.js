/**
 * 网页版资源构建
 * 用法: node data-pipeline/build-web.js
 * 输出: web/kb-bundle.js —— 把两份知识库注入 window，供 web/ 演示页与知识库页使用
 * （web 页直接引用 cloudfunctions/analyze/rules/data.js 与 engine.js，单一事实源不复制逻辑）
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const additives = JSON.parse(fs.readFileSync(path.join(ROOT, 'cloudfunctions/analyze/rules/kb.additives.json'), 'utf-8'))
const purine = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/purine.kb.json'), 'utf-8'))
const disease = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/disease-rules.kb.json'), 'utf-8'))

const bundle = `// 本文件由 data-pipeline/build-web.js 自动生成，请勿手改
// 生成时间: ${new Date().toISOString()}
window.AdditivesKB = ${JSON.stringify(additives)};
window.PurineKB = ${JSON.stringify(purine)};
window.DiseaseRulesKB = ${JSON.stringify(disease)};
`

const out = path.join(ROOT, 'web/kb-bundle.js')
if (!fs.existsSync(path.dirname(out))) fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, bundle)
console.log(`✔ web/kb-bundle.js 生成（添加剂 ${additives.entries.length} 条 / 嘌呤 ${purine.entries.length} 条 / 慢病规则 ${disease.conditions.length} 组）`)
