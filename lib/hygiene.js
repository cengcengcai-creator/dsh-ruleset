/** 规则卫生检查：重复、缺判据、过长、token 成本。 */
import fs from 'node:fs'
import path from 'node:path'
import { resolveRuleSource } from './source.js'

const logFile = () => path.join(process.env.HOME || '', '.dsh', 'workspace', '.ruleset', 'guard.log')

export function guardHits(windowStart = 0) {
  const out = []
  try {
    for (const line of fs.readFileSync(logFile(), 'utf8').split('\n')) {
      if (!line.trim()) continue
      const [at, pattern, cmd] = line.split('\t')
      if (pattern === 'REGISTERED') continue
      const t = Date.parse(at)
      if (windowStart && t && t < windowStart) continue
      out.push({ at, pattern, cmd })
    }
  } catch { /* 无日志 */ }
  return out
}

const norm = (s) => String(s || '').replace(/\s+/g, '').toLowerCase()

/** 冲突检测：同一对象上「必须/禁止」相反，或对象范围重叠但要求相反。 */
export function detectConflicts(rules) {
  const NEG = /禁止|不得|不允许|不要|严禁/
  const POS = /必须|应当|需要|务必|一定要/
  const objOf = (r) => {
    const binds = Array.isArray(r.observe?.binds) ? r.observe.binds : (r.observe?.bind ? [r.observe.bind] : [])
    const b = binds[0] || {}
    return String(b.pathPattern || b.pattern || b.taskPattern || b.fields?.join(',') || b.key || '')
  }
  const words = (t) => String(t || '').replace(/[。，、；：！？\s]/g, '').slice(0, 200)
  const out = []
  for (let i = 0; i < rules.length; i += 1) {
    for (let j = i + 1; j < rules.length; j += 1) {
      const a = rules[i]; const b = rules[j]
      const ta = words(a.text); const tb = words(b.text)
      const negA = NEG.test(ta); const negB = NEG.test(tb)
      const posA = POS.test(ta); const posB = POS.test(tb)
      if (!((negA && posB) || (negB && posA))) continue
      const oa = objOf(a); const ob = objOf(b)
      const overlap = oa && ob && (oa === ob || oa.includes(ob) || ob.includes(oa))
      // 关键词共现（去重后 >=2 个 4 字以上片段）
      const seg = (t) => new Set((t.match(/[\u4e00-\u9fa5]{4,8}/g) || []))
      const sa = seg(ta); const sb = seg(tb)
      let common = 0
      for (const x of sa) if (sb.has(x)) common += 1
      if (common >= 2 || (overlap && common >= 1)) {
        out.push({ a: a.id, b: b.id, reason: overlap ? `对象重叠（${oa.slice(0, 20)}）且一条要求、一条禁止` : `共同主题 ${common} 处，且一条要求、一条禁止` })
      }
    }
  }
  return out.slice(0, 10)
}

/** 判据覆盖三档：可判（有 bind）/ 半可判（有事实源但没写 bind）/ 不可判（语义型）。 */
export function bindCoverage(rules) {
  const tiers = { redline: { total: 0, withBind: 0 }, hard: { total: 0, withBind: 0 }, soft: { total: 0, withBind: 0 } }
  let withBind = 0
  const noBind = []
  for (const r of rules) {
    const tier = r.tier || (r.kind === 'constraint' ? 'redline' : 'hard')
    const binds = Array.isArray(r.observe?.binds) ? r.observe.binds : (r.observe?.bind ? [r.observe.bind] : [])
    if (!tiers[tier]) tiers[tier] = { total: 0, withBind: 0 }
    tiers[tier].total += 1
    if (binds.length) { tiers[tier].withBind += 1; withBind += 1 }
    else noBind.push(r.id)
  }
  const total = rules.length || 1
  return { total: rules.length, withBind, rate: Number((withBind / total).toFixed(2)), byTier: tiers, noBind }
}

/** 证据可指回：判据是否可能产出 seq / 路径（静态判断，看 bind 类型）。 */
const EVIDENCE_OK = new Set(['regex', 'path-boundary', 'never', 'approval-gated', 'bypass', 'wal', 'turn-condition', 'declare-first', 'phase-gap', 'field-presence', 'doc-refs', 'change-gate', 'command-audit', 'job-dangling', 'permission-change', 'explain-first', 'sequence-order', 'count-threshold', 'duration', 'per-turn-cap'])
export function evidenceAbility(rules) {
  const out = { ok: 0, weak: 0, none: 0, weakRules: [] }
  for (const r of rules) {
    const binds = Array.isArray(r.observe?.binds) ? r.observe.binds : (r.observe?.bind ? [r.observe.bind] : [])
    if (!binds.length) { out.none += 1; continue }
    const weak = binds.filter((b) => !EVIDENCE_OK.has(b.type) || (b.type === 'metric' && !b.key))
    if (weak.length) { out.weak += 1; out.weakRules.push({ id: r.id, types: weak.map((b) => b.type) }) }
    else out.ok += 1
  }
  return out
}

export function hygieneReport() {
  const src = resolveRuleSource('')
  const rules = src.policy?.rules || []
  const dupes = []
  const seen = new Map()
  for (const r of rules) {
    const k = norm(r.text).slice(0, 60)
    if (!k) continue
    if (seen.has(k)) dupes.push({ a: seen.get(k), b: r.id })
    else seen.set(k, r.id)
  }
  const noBind = rules.filter((r) => {
    const binds = Array.isArray(r.observe?.binds) ? r.observe.binds : (r.observe?.bind ? [r.observe.bind] : [])
    return binds.length === 0
  }).map((r) => r.id)
  const long = rules.filter((r) => String(r.text || '').length > 200).map((r) => ({ id: r.id, chars: String(r.text).length }))
  const cost = rules.map((r) => ({ id: r.id, chars: String((r.title || '') + (r.text || '')).length }))
  const totalChars = cost.reduce((a, x) => a + x.chars, 0)
  return {
    total: rules.length,
    totalChars,
    estimatedTokens: Math.round(totalChars / 1.6),
    dupes,
    noBind,
    long,
    cost: cost.sort((a, b) => b.chars - a.chars).slice(0, 5),
    conflicts: detectConflicts(rules),
    coverage: bindCoverage(rules),
    evidence: evidenceAbility(rules),
  }
}
