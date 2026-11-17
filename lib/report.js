import fs from 'node:fs'
import path from 'node:path'
/** 判定层：规则来自 policy，判据来自 rule.observe.bind（六类谓词之一）。 */
import { PREDICATES } from './predicates.js'
import { runPredicate } from './predicates.js'
import { guidanceFor } from './source.js'
import { dedupeRules } from './dedupe.js'

const SEVERITY = { violation: 3, warn: 2, stat: 1, pass: 2, unknown: 0 }

/** 按容忍度收敛结论：小比例违规降级为 warn/pass，避免满屏飘红。 */
/** 严重度映射（照 OpenClaw 的口径）：red=客观不可争议，yellow=判据明确但非阻塞，stat=只统计。 */
function statusFor(hits, base, rule) {
  if (!hits) return 'pass'
  const sev = rule.severity || (rule.kind === 'constraint' ? 'red' : 'yellow')
  if (sev === 'stat') return 'stat'
  if (sev === 'red') return 'violation'
  return 'warn'
}

export function evaluate(policy, facts) {
  const rules = Array.isArray(policy?.rules) ? policy.rules : []
  return rules.map((r) => {
    const binds = []
    if (Array.isArray(r.observe?.binds)) binds.push(...r.observe.binds.filter((b) => b && b.type))
    else if (r.observe?.bind?.type) binds.push(r.observe.bind)
    if (!binds.length) {
      return { id: r.id, title: r.title, kind: r.kind, status: 'unknown', detail: '未声明谓词绑定（semantic 规则，仅提示）', metric: r.observe?.metric || '', hits: 0, base: 0, rate: null }
    }
    const vs = binds.map((b) => {
      const v = runPredicate(facts, b)
      const status = v.status === 'unknown' ? 'unknown' : statusFor(v.hits ?? 0, v.base ?? 0, { ...r, severity: r.severity || b.severity })
      return { bind: b, v: { ...v, status } }
    })
    const worst = vs.reduce((a, b) => (SEVERITY[b.v.status] > SEVERITY[a.v.status] ? b : a), vs[0])
    const detail = vs.length === 1 ? worst.v.detail : vs.map((x) => `[${x.bind.type}] ${x.v.status} · ${x.v.detail}`).join('；')
    return {
      id: r.id, title: r.title, kind: r.kind, status: worst.v.status, detail,
      metric: r.observe?.metric || '', samples: worst.v.samples,
      hits: worst.v.hits ?? 0, base: worst.v.base ?? 0, rate: worst.v.rate ?? null,
      bindTypes: binds.map((b) => b.type),
    }
  })
}

export function render(policy, facts, rows, source = { kind: 'policy', warnings: [] }) {
  const draft = source?.kind === 'agents-draft'
  if (draft) rows = rows.map((r) => ({ ...r, status: 'unknown', detail: `草稿未确认（${r.detail}）` }))
  const unknown = rows.filter((r) => r.status === 'unknown').length
  const L = ['观测报告（dsh-ruleset）',
    `数据源：${facts.dir || '-'}（HOME=${facts.home || '-'}；${facts.sessions}/${facts.files || 0} 会话，解压 ${facts.bytes || 0}B，失败 ${(facts.unavailable || []).length}）`,
    `样本：${facts.sample ? `原 ${facts.sample.rawSize}B → 解 ${facts.sample.decoded}B（${facts.sample.rows} 行，zstd=${facts.sample.zstd}）` : '无'}`,
    `事实：${facts.sessions} 会话 / ${facts.turns.length} 轮 / ${facts.commands.length} 命令 / ${facts.fileWrites.length} 写文件`,
    '', '规则状态：']
  for (const r of rows) {
    const num = r.base && !String(r.detail).includes('/') ? ` (${r.hits}/${r.base}${r.rate === null ? '' : ` = ${Math.round(r.rate * 100)}%`})` : ''
    L.push(`- [${r.status}] ${r.title || r.id}${num} — ${r.detail}`)
  }
  L.push('', `汇总：${rows.length - unknown} 条可判定，${unknown} 条 unknown`)
  const ded = dedupeRules(policy?.rules || [], source?.agentsText)
  L.push(`注入：${ded.kept.length} 条进提示词，${ded.skipped.length} 条与 AGENTS.md 重复已跳过（源：${source?.kind || 'none'}）`)
  for (const w of (source?.warnings || [])) L.push(`⚠️ ${w}`)
  const guide = guidanceFor(source)
  if (guide.length) L.push('', ...guide)
  return L.join('\n')
}
