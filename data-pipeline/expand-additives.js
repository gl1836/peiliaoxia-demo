/**
 * 添加剂扩量管线
 * 用法: node data-pipeline/expand-additives.js
 *
 * 输入: data/sources/gb2760-cfsa-additives.json（CFSA 官方库快照，290 条非香料类全量品种）
 * 输出: data/additives.kb.json（合并后主库）
 *
 * 合并策略:
 *   - 按 名称/别名/INS 匹配已有条目 → 仅回填缺失的 cns/ins/aliases，不动人工审定过的分级与解释
 *   - 未命中 → 新建条目：level=safe（国标允许使用即默认安全）、confidence=medium（自动进入营养师待审队列）、
 *     explain/funExplain 按功能类别模板生成，待营养师逐条审定后升级 confidence=high
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const KB_PATH = path.join(ROOT, 'data/additives.kb.json')
const CFSA_PATH = path.join(ROOT, 'data/sources/gb2760-cfsa-additives.json')

// 功能类别 → 大白话解释模板（新建条目用，营养师审定后逐条替换为精确表述）
const CATEGORY_EXPLAIN = {
  防腐剂: '抑制微生物繁殖、延长保质期，国标限量内使用安全',
  抗氧化剂: '防止油脂氧化哈败，保持食品风味，国标限量内使用安全',
  着色剂: '赋予食品色泽，国标对使用范围和限量有严格规定',
  甜味剂: '提供甜味，热量低或无热量，国标限量内使用安全',
  增稠剂: '增加黏稠度、改善口感，多为天然来源多糖，安全性高',
  乳化剂: '让油和水均匀混合不分层，国标限量内使用安全',
  酸度调节剂: '调节酸碱度、改善风味，国标限量内使用安全',
  增味剂: '增强鲜味，国标限量内使用安全',
  膨松剂: '让面制品疏松多孔，国标限量内使用安全',
  凝固剂: '使食品凝固成型（如豆腐），使用历史悠久',
  抗结剂: '防止粉状食品结块，国标限量内使用安全',
  水分保持剂: '保持肉制品水分和嫩度，国标限量内使用安全',
  稳定剂: '保持食品结构稳定，国标限量内使用安全',
  护色剂: '保持肉制品色泽，国标对使用范围限制严格',
  漂白剂: '漂白或防止褐变，国标对残留量有严格限制',
  被膜剂: '在食品表面形成保护膜，保鲜防粘，安全性高',
  面粉处理剂: '改善面粉加工性能，国标限量内使用安全',
  胶姆糖基础剂: '口香糖胶基成分，不被人体吸收',
  固化剂: '使食品保持形态稳定，国标限量内使用安全',
  其他: '国标允许使用的食品添加剂，按规定使用安全'
}

const CATEGORY_FUN = {
  防腐剂: '食品的「保质期卫士」，专门对付让食物变质的霉菌和细菌。没有它，很多食品几天就会坏掉。',
  抗氧化剂: '油脂的「防锈剂」——没有它，含油食品放久了会有哈喇味。',
  着色剂: '食品的「化妆师」。合规使用安全，但颜色过分鲜艳的食品，给孩子选时多留个心眼。',
  甜味剂: '不提供（或很少提供）热量的「甜味替身」，控糖人群的折中选择，但别因此放开吃甜。',
  增稠剂: '让酸奶浓稠、果冻 Q 弹的「口感工程师」，多数是天然提取的多糖，相当温和。',
  乳化剂: '油和水的「和事佬」，没有它冰淇淋和沙拉酱会分层。',
  酸度调节剂: '食品的「酸味调音师」，调节酸碱度让风味更平衡。',
  增味剂: '鲜味的「放大器」，让食物吃起来更鲜美。',
  膨松剂: '让馒头蛋糕蓬松的「打气筒」。',
  凝固剂: '点豆腐的「魔术师」，把豆浆变成豆腐。',
  抗结剂: '盐罐里的「防潮员」，让粉末保持松散。',
  水分保持剂: '肉制品的「锁水膜」，让口感更嫩。',
  稳定剂: '食品的「结构师」，让质地保持稳定不分层。',
  护色剂: '肉制品的「腮红师」，国标对它的使用范围卡得很死。',
  漂白剂: '食品的「美白师」，国标对残留量卡得很严。',
  被膜剂: '水果糖果的「隐形雨衣」，保鲜又防粘。',
  面粉处理剂: '面粉的「健身教练」，改善筋度和加工性能。',
  胶姆糖基础剂: '口香糖的「骨架」，嚼完吐掉，不消化吸收。',
  固化剂: '帮食品「定型」的小助手。',
  其他: '国标允许使用的添加剂，按规定使用安全。'
}

// 括号配平扫描：从 start 处的开括号找到对应闭括号（处理化学名中的嵌套括号）
function matchParen(s, start) {
  let depth = 0
  for (let i = start; i < s.length; i++) {
    if ('（(['.includes(s[i])) depth++
    else if ('）)]'.includes(s[i])) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

// 括号感知的逗号拆分（「L（+）-酒石酸，dl-酒石酸」→ 两项；括号内的逗号不拆）
function splitTopLevel(s) {
  const parts = []
  let depth = 0, cur = ''
  for (const ch of s) {
    if ('（(['.includes(ch)) depth++
    else if ('）)]'.includes(ch)) depth--
    if ((ch === '，' || ch === ',' || ch === '、') && depth === 0) { parts.push(cur); cur = '' }
    else cur += ch
  }
  if (cur.trim()) parts.push(cur)
  return parts.map(x => x.trim()).filter(Boolean)
}

function parseCfsaName(raw) {
  // 处理三类括号注释：又名（可能嵌套化学名括号）、包括（组条目列举）、简称
  const aliases = []
  let name = raw.trim()

  // 1. 提取「（包括…）」「[包括…]」→ 列举的各物质作为别名
  for (;;) {
    const m = name.match(/[（([]包括/)
    if (!m) break
    const open = m.index
    const close = matchParen(name, open)
    if (close < 0) break
    const inner = name.slice(open + 1, close).replace(/^包括/, '')
    for (const part of splitTopLevel(inner)) {
      const sub = parseCfsaName(part) // 递归处理别名里的「又名」
      aliases.push(sub.name, ...sub.aliases)
    }
    name = (name.slice(0, open) + name.slice(close + 1)).trim()
  }

  // 2. 提取「（又名…）」（括号配平，兼容化学名嵌套）
  for (;;) {
    const m = name.match(/[（(]又名[：:]?/)
    if (!m) break
    const open = m.index
    const close = matchParen(name, open)
    if (close < 0) break
    const inner = name.slice(m.index + m[0].length, close)
    for (const a of splitTopLevel(inner)) aliases.push(a)
    name = (name.slice(0, open) + name.slice(close + 1)).trim()
  }

  // 3. 提取「（简称“X”）」
  const sm = name.match(/[（(]简称[“"](.+?)[”"][)）]/)
  if (sm) {
    aliases.push(sm[1])
    name = name.replace(sm[0], '').trim()
  }

  // 4. 剩余部分若仍是顶层逗号并列（如「硝酸钠，硝酸钾」），第一个为正名，其余为别名
  const tops = splitTopLevel(name)
  if (tops.length > 1) {
    name = tops[0]
    aliases.push(...tops.slice(1))
  }

  return { name, aliases: Array.from(new Set(aliases)).filter(a => a && a !== name) }
}

function pickCategory(functions) {
  const first = (functions || '').split(/[、,，]/)[0].trim()
  return CATEGORY_EXPLAIN[first] ? first : '其他'
}

function expand() {
  const kb = JSON.parse(fs.readFileSync(KB_PATH, 'utf-8'))
  const cfsa = JSON.parse(fs.readFileSync(CFSA_PATH, 'utf-8'))

  // 索引已有条目：name/alias → entry；ins → entry
  const byTerm = new Map()
  const byIns = new Map()
  for (const e of kb.entries) {
    for (const t of [e.name, ...(e.aliases || [])]) byTerm.set(t.trim(), e)
    if (e.ins) byIns.set(String(e.ins).replace(/^INS/i, ''), e)
  }

  let merged = 0, created = 0, skippedAliasConflict = 0
  const usedIds = new Set(kb.entries.map(e => e.id))

  for (const c of cfsa.entries) {
    const { name, aliases } = parseCfsaName(c.name)
    const ins = (c.ins || '').trim()
    const existing = byTerm.get(name) || aliases.map(a => byTerm.get(a)).find(Boolean) || (ins && byIns.get(ins))

    if (existing) {
      // 回填缺失字段，不动人工内容
      if (!existing.cns && c.cns) existing.cns = c.cns
      if (!existing.ins && ins) existing.ins = ins
      for (const a of aliases) {
        if (!(existing.aliases || []).includes(a) && existing.name !== a && !byTerm.has(a)) {
          existing.aliases = existing.aliases || []
          existing.aliases.push(a)
          byTerm.set(a, existing)
        }
      }
      merged++
      continue
    }

    // 新建条目
    const category = pickCategory(c.functions)
    let id = c.cns ? 'CNS' + c.cns : (ins ? 'INS' + ins : 'NAME-' + name)
    if (usedIds.has(id)) id = id + '-' + name
    usedIds.add(id)

    // 别名若与其他条目冲突则丢弃（构建校验不允许跨条目别名冲突）
    const safeAliases = aliases.filter(a => {
      const owner = byTerm.get(a)
      if (owner) { skippedAliasConflict++; return false }
      return true
    })

    const entry = {
      id,
      name,
      aliases: safeAliases,
      ins: ins || undefined,
      cns: c.cns || undefined,
      category,
      func: c.functions || category,
      level: 'safe',
      childLevel: 'safe',
      explain: CATEGORY_EXPLAIN[category],
      childExplain: '国标允许使用的添加剂，合规剂量下儿童可食用',
      funExplain: CATEGORY_FUN[category],
      sources: ['GB2760', 'CFSA官方数据库'],
      confidence: 'medium',
      nameEn: c.nameEn || undefined
    }
    kb.entries.push(entry)
    byTerm.set(name, entry)
    safeAliases.forEach(a => byTerm.set(a, entry))
    if (ins) byIns.set(ins, entry)
    created++
  }

  kb.version = '2026.08.31-cfsa-full'
  kb.updatedAt = '2026-08-31'
  kb.meta.sources = Array.from(new Set([...(kb.meta.sources || []), 'CFSA GB 2760-2024 在线查询数据库（全量品种快照 2026-08-31）']))
  kb.meta.notes = '人工审定高频条目 + CFSA 官方库全量扩量；新增条目默认 safe/medium，待注册营养师逐条审定分级'

  fs.writeFileSync(KB_PATH, JSON.stringify(kb, null, 2))
  console.log(`✔ 合并完成: 回填 ${merged} 条 / 新增 ${created} 条 / 别名冲突跳过 ${skippedAliasConflict} 个`)
  console.log(`✔ 主库现共 ${kb.entries.length} 条`)
}

expand()
