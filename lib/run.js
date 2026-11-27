/** 审计执行器：facts → policy → 判定 → 扣减已标记 → 快照 → 发现 → 趋势。 */
import fs from 'node:fs'
import path from 'node:path'
import { buildFacts } from './facts.js'
import { evaluate, render } from './report.js'
import { resolveRuleSource } from './source.js'
import { saveHistory, readHistory, readSeries, seriesByTime } from './history.js'
import { explainBind } from './explain.js'
import { collectFindings, loadFindings, findingSummary } from './findings.js'
import { guardHits } from './hygiene.js'
import { readInjected } from './injected-log.js'
import { loadBaseline, applySignificance, buildBaseline, saveBaseline } from './stats.js'
import { lastLoadError } from './policy.js'

export function snapshotPath() {
  return path.join(process.env.HOME || '', '.dsh', 'workspace', '.ruleset', 'report.json')
}

const TRIAGED = new Set(['false_positive', 'fixed', 'accepted'])

export function runAudit({ windowHours = 720, policyPath = '' } = {}) {
  const source = resolveRuleSource(policyPath)
  const policy = source.policy
  const facts = buildFacts(windowHours)
  const rows = evaluate(policy, facts)

  // 已被标记的发现要从命中里扣掉，否则计数永远不动
  const prior = loadFindings()
  const triaged = {}
  for (const f of Object.values(prior)) {
    if (f && TRIAGED.has(f.status)) triaged[f.ruleId] = (triaged[f.ruleId] || 0) + 1
  }
  for (const r of rows) {
    const sub = triaged[r.id] || 0
    if (!sub) continue
    const hits = Math.max(0, (r.hits || 0) - sub)
    r.hits = hits
    r.rate = r.base > 0 ? hits / r.base : null
    if (hits === 0 && r.status !== 'unknown') r.status = 'pass'
    r.detail = hits === 0 ? `命中已被标记处理（${sub} 条）` : `${r.detail}（已扣减 ${sub} 条已标记）`
  }

  applySignificance(rows, loadBaseline())
  const withBind = rows.filter((r) => (r.bindTypes || []).length).length
  const judged = rows.filter((r) => r.status !== 'unknown').length
  const summary = {
    total: rows.length,
    pass: rows.filter((r) => r.status === 'pass').length,
    violation: rows.filter((r) => r.status === 'violation').length,
    warn: rows.filter((r) => r.status === 'warn').length,
    stat: rows.filter((r) => r.status === 'stat').length,
    unknown: rows.filter((r) => r.status === 'unknown').length,
    bindCoverage: Number((withBind / (rows.length || 1)).toFixed(2)),
    judgeRate: Number((judged / (rows.length || 1)).toFixed(2)),
  }

  const loadError = lastLoadError()
  const payload = {
    at: new Date().toISOString(),
    loadError,
    windowHours,
    source: { kind: source.kind, file: source.file, draft: source.kind === 'agents-draft' },
    facts: {
      sessions: facts.sessions,
      turns: facts.turns.length,
      commands: facts.commands.length,
      writes: facts.fileWrites.length,
      bytes: facts.bytes || 0,
      unavailable: (facts.unavailable || []).length,
    },
    summary,
    rows: rows.map((r) => {
      const rule = (policy.rules || []).find((x) => x.id === r.id) || {}
      const bindList = Array.isArray(rule.observe?.binds) ? rule.observe.binds : (rule.observe?.bind ? [rule.observe.bind] : [])
      const bind = bindList[0] || null
      return {
        id: r.id, title: r.title, kind: r.kind, status: r.status,
        tier: rule.tier || (rule.kind === 'constraint' ? 'redline' : 'hard'),
        text: rule.text || '',
        bindType: bind?.type || null,
        bindTypes: bindList.map((b) => b.type),
        binds: bindList,
        explain: bindList.length ? bindList.map((b) => explainBind(b)).join(' ｜ ') : explainBind(null),
        hits: r.hits, base: r.base, rate: r.rate, detail: r.detail,
        z: r.z, significance: r.significance,
        samples: (r.samples || []).slice(0, 3),
      }
    }),
  }

  const findings = collectFindings(rows)
  payload.findings = findings
  payload.guardHits = guardHits(facts.windowStart || 0)
  payload.injected = readInjected(5)
  const bl = loadBaseline()
  const ids = Object.keys(bl)
  payload.baseline = ids.length ? { rules: ids.length, at: Object.values(bl)[0]?.at || '' } : null
  payload.triaged = triaged
  payload.findingSummary = findingSummary(findings)

  try {
    fs.mkdirSync(path.dirname(snapshotPath()), { recursive: true })
    fs.writeFileSync(snapshotPath(), JSON.stringify(payload, null, 2))
  } catch { /* 快照失败不影响返回 */ }

  saveHistory(payload)
  const rawSeries = readSeries(200)
  payload.series = rawSeries.slice(-30)
  payload.trend = seriesByTime(rawSeries, 60, 24)
  payload.trendDay = seriesByTime(rawSeries, 1440, 30)
  payload.trendWeek = seriesByTime(rawSeries, 10080, 12)
  payload.trendBucketMinutes = 60
  payload.history = readHistory(14)

  return { payload, text: render(policy, facts, rows, source) }
}
