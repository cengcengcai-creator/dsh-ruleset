/**
 * 唯一的操作实现：工具、HTTP 路由、未来的客户端命令都调这里。
 * 任一处改动都在这个文件里，避免三个入口各写一遍。
 */
import fs from 'node:fs'
import { runAudit, snapshotPath } from './run.js'
import { listRules, addRule, removeRule, dedupeRules, updateRule, setTier } from './rules-edit.js'
import { setFindingStatus } from './findings.js'
import { parseSentence } from './extract.js'
import { parseWithLlm } from './llm-parse.js'
import { judgeSemantic } from './judge.js'
import { introspectRule } from './introspect.js'
import { buildBaseline, saveBaseline, loadBaseline } from './stats.js'
import { resolveRuleSource } from './source.js'
import { initDraft } from './init.js'
import { PREDICATE_DOCS } from './predicates.js'
import { hygieneReport, guardHits } from './hygiene.js'
import { adviseAll } from './advice.js'
import { readInjected } from './injected-log.js'
import { listBackups, restoreBackup, exportForKeep, backupPolicy } from './backups.js'

const ok = (value) => ({ ok: true, value })
const fail = (code, message) => ({ ok: false, error: { code, message } })

export function createService(ctx) {
  const report = (a = {}) => {
    const hours = Number(a.window_hours) > 0 ? Number(a.window_hours) : 720
    if (a.refresh) return ok(runAudit({ windowHours: hours }).payload)
    try { return ok(JSON.parse(fs.readFileSync(snapshotPath(), 'utf8'))) } catch { return fail('dsh-ruleset/no-report', '还没有报告：先跑一次审计') }
  }
  const audit = (a = {}) => {
    const hours = Number(a.window_hours) > 0 ? Number(a.window_hours) : 720
    return ok(runAudit({ windowHours: hours }).payload)
  }
  return {
    report,
    audit,
    rules: () => ok(listRules()),
    addRule: (a) => { const r = addRule(a); return r.ok ? ok(r) : fail('dsh-ruleset/add-rule-failed', r.error) },
    removeRule: (a) => { const r = removeRule(a); return r.ok ? ok(r) : fail('dsh-ruleset/remove-rule-failed', r.error) },
    updateRule: (a) => { const r = updateRule(a); return r.ok ? ok(r) : fail('dsh-ruleset/update-rule-failed', r.error) },
    setTier: (a) => { const r = setTier(a); return r.ok ? ok(r) : fail('dsh-ruleset/set-tier-failed', r.error) },
    dedupe: () => { const r = dedupeRules(); return r.ok ? ok(r) : fail('dsh-ruleset/dedupe-failed', r.error) },
    init: (a) => { try { return ok(initDraft(a)) } catch (e) { return fail('dsh-ruleset/init-failed', e?.message || String(e)) } },
    predicates: () => ok(Object.entries(PREDICATE_DOCS).map(([type, d]) => ({ type, ...d }))),
    parse: async (a) => {
      const text = String(a?.text || '')
      if (!text.trim()) return fail('dsh-ruleset/bad-request', 'text 为空')
      const viaLlm = await parseWithLlm(ctx, text)
      if (viaLlm && !viaLlm.error) return ok(viaLlm)
      const h = parseSentence(text)
      return ok({ classification: h.classification, bind: h.bind, by: 'heuristic', reason: viaLlm?.error || '' })
    },
    judge: async (a) => {
      const src = resolveRuleSource('')
      return ok(await judgeSemantic(ctx, src.policy || { rules: [] }, { windowHours: Number(a?.window_hours) || 168 }))
    },
    introspect: async (a) => {
      const src = resolveRuleSource('')
      const rules = src.policy?.rules || []
      const targets = a?.id ? rules.filter((r) => r.id === a.id) : rules.slice(0, Number(a?.limit) || 3)
      const items = []
      for (const r of targets) items.push(await introspectRule(ctx, r))
      return ok({ items })
    },
    suggest: () => {
      const src = resolveRuleSource('')
      const out = []
      for (const r of (src.policy?.rules || [])) {
        const binds = Array.isArray(r.observe?.binds) ? r.observe.binds : (r.observe?.bind ? [r.observe.bind] : [])
        if (binds.length) continue
        const parsed = parseSentence(`${r.title || ''}：${r.text || ''}`)
        out.push({ id: r.id, title: r.title, suggestion: parsed.bind || null, classification: parsed.classification })
      }
      return ok({ items: out })
    },
    baseline: (a) => {
      if (a?.action === 'get') return ok(loadBaseline())
      const { payload } = runAudit({ windowHours: Number(a?.window_hours) || 168 })
      const map = buildBaseline(payload.rows)
      return saveBaseline(map) ? ok({ saved: Object.keys(map).length }) : fail('dsh-ruleset/baseline-failed', '写入失败')
    },
    hygiene: () => ok(hygieneReport()),
    applyAdvice: async (a) => {
      const src = resolveRuleSource('')
      const rule = (src.policy?.rules || []).find((r) => r.id === a?.id)
      if (!rule) return fail('dsh-ruleset/rule-missing', `没有找到规则 ${a?.id}`)
      const act = a?.action || {}
      if (act.kind === 'set-tier') {
        const r = setTier({ id: rule.id, tier: act.tier })
        return r.ok ? ok(r) : fail('dsh-ruleset/set-tier-failed', r.error)
      }
      if (act.kind === 'append-text') {
        const text = String(rule.text || '') + String(act.text || '')
        const r = updateRule({ id: rule.id, text })
        return r.ok ? ok(r) : fail('dsh-ruleset/update-failed', r.error)
      }
      if (act.kind === 'update-bind' || act.kind === 'replace-bind') {
        const binds = Array.isArray(rule.observe?.binds) ? rule.observe.binds.slice() : (rule.observe?.bind ? [rule.observe.bind] : [])
        if (!binds.length) return fail('dsh-ruleset/no-bind', '这条规则没有判据可改')
        binds[0] = act.kind === 'replace-bind' ? { ...act.bind } : { ...binds[0], ...act.patch }
        const r = updateRule({ id: rule.id, binds })
        return r.ok ? ok(r) : fail('dsh-ruleset/update-failed', r.error)
      }
      if (act.kind === 'suggest-bind') {
        const text = `${rule.title || ''}：${rule.text || ''}`
        const viaLlm = await parseWithLlm(ctx, text)
        const bind = (viaLlm && !viaLlm.error ? viaLlm.bind : null) || parseSentence(text).bind
        if (!bind) return fail('dsh-ruleset/no-bind-suggested', '这句没解析出可机械化的判据')
        const r = updateRule({ id: rule.id, binds: [bind] })
        return r.ok ? ok({ ...r, bind }) : fail('dsh-ruleset/update-failed', r.error)
      }
      return fail('dsh-ruleset/unknown-action', `不认识的建议动作：${act.kind}`)
    },
    advise: () => {
      const src = resolveRuleSource('')
      return ok(adviseAll(src.policy?.rules || []))
    },
    injected: (a) => ok({ entries: readInjected(Number(a?.limit) || 20) }),
    backups: () => ok({ items: listBackups() }),
    restore: (a) => { const r = restoreBackup(a?.file); return r.ok ? ok(r) : fail('dsh-ruleset/restore-failed', r.error) },
    backup: (a) => { const r = backupPolicy(a?.action || 'manual'); return r.ok ? ok(r) : fail('dsh-ruleset/backup-failed', r.error) },
    exportKeep: (a) => { const r = exportForKeep(a?.dir); return r.ok ? ok(r) : fail('dsh-ruleset/export-failed', r.error) },
    guardLog: (a) => ok({ hits: guardHits(Date.now() - (Number(a?.window_hours) || 720) * 3600 * 1000) }),
    findingStatus: (a) => { const r = setFindingStatus(a); return r.ok ? ok(r) : fail('dsh-ruleset/finding-status-failed', r.error) },
  }
}
