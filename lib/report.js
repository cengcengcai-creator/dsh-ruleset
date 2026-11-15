/** 判定层：规则来自 policy，判据来自 rule.observe.bind（六类谓词之一）。 */
import { buildFacts } from './facts.js'
import { runPredicate } from './predicates.js'
import { guidanceFor } from './source.js'
import { dedupeRules } from './dedupe.js'

export function evaluate(policy, facts) {
  const rules = Array.isArray(policy?.rules) ? policy.rules : []
  return rules.map((r) => {
    const bind = r.observe?.bind
    if (!bind) return { id: r.id, title: r.title, kind: r.kind, status: 'unknown', detail: '未声明谓词绑定（semantic 规则）', metric: r.observe?.metric || '', hits: 0, base: 0, rate: null }
    const v = runPredicate(facts, bind)
    return { id: r.id, title: r.title, kind: r.kind, status: v.status, detail: v.detail, metric: r.observe?.metric || '', samples: v.samples, hits: v.hits ?? 0, base: v.base ?? 0, rate: v.rate ?? null }
  })
}

export function render(policy, facts, rows, source = { kind: 'policy', warnings: [] }) {
  const draft = source?.kind === 'agents-draft'
  if (draft) rows = rows.map((r) => ({ ...r, status: 'unknown', detail: `草稿未确认（${r.detail}）` }))
  const unknown = rows.filter((r) => r.status === 'unknown').length
  const L = ['观测报告（dsh-ruleset）', `事实：${facts.sessions} 会话 / ${facts.turns.length} 轮 / ${facts.commands.length} 命令 / ${facts.fileWrites.length} 写文件`, '', '规则状态：']
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
