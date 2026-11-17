/** 发现级记录：逐条留痕 + 生命周期状态（误报永不删除，只改状态）。 */
import fs from 'node:fs'
import path from 'node:path'

const STATUSES = ['open', 'fixed', 'accepted', 'false_positive', 'superseded']
const file = () => path.join(process.env.HOME || '', '.dsh', 'workspace', '.ruleset', 'findings.json')

export function loadFindings() {
  try { return JSON.parse(fs.readFileSync(file(), 'utf8')) } catch { return {} }
}

function save(all) {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true })
    fs.writeFileSync(file(), JSON.stringify(all, null, 2))
    return true
  } catch { return false }
}

const hash = (s) => {
  let h = 0
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h).toString(36)
}

/** 从判定结果里抽出发现条目，并合并历史状态。 */
function incidentKey(ruleId, s, prevTs) {
  const ts = Number(s.atMs || 0) || Date.parse(s.at || '') || 0
  const sameBurst = prevTs && ts && ts - prevTs <= 15000
  return { ts, sameBurst }
}

export function collectFindings(rows) {
  const all = loadFindings()
  const out = []
  for (const r of rows) {
    if (!r.hits) continue
    const samples = (r.samples || []).slice(0, 40)
    const list = samples.length ? samples : [{ detail: r.detail }]
    // 事故合并：同规则同会话、15 秒内的连续命中合成一条
    const groups = []
    for (const s of list) {
      const ts = Number(s.atMs || 0) || Date.parse(s.at || '') || 0
      const last = groups[groups.length - 1]
      if (last && last.session === (s.session || '') && ts && last.lastTs && ts - last.lastTs <= 15000) {
        last.items.push(s); last.lastTs = ts; continue
      }
      groups.push({ session: s.session || '', lastTs: ts, items: [s] })
    }
    for (const g of groups) {
      const s = g.items[0]
      const burst = g.items.length > 1 ? `（15s 内连续 ${g.items.length} 次，合并为 1 起事故）` : ''
      const sAll = { ...s, extra: [s.extra, burst].filter(Boolean).join('') }
      const where = sAll.file || sAll.path || sAll.session || ''
      const what = sAll.user || sAll.cmd || sAll.id || sAll.detail || ''
      const extra = [sAll.lacks && `缺少 ${sAll.lacks.join('、')}`, sAll.calls && `${sAll.calls} 次调用`, sAll.extra].filter(Boolean).join('；')
      const label = what ? `「${String(what).slice(0, 80)}」` : '（系统触发轮次，无用户输入）'
      const evidence = [sAll.at, where, label, extra].filter(Boolean).join(' · ')
      const anchor = sAll.seq || sAll.path || sAll.id || ''
      const key = `${r.id}|${sAll.session || ''}|${anchor}|${Math.floor((Number(sAll.atMs || 0) || 0) / 60000)}`
      const prev = all[key]
      const level = r.status === 'violation' ? 'red' : r.status === 'warn' ? 'yellow' : 'stat'
      const rec = prev
        ? { ...prev, evidence, level, ruleTitle: r.title, seen: (prev.seen || 1) + 1, lastSeen: new Date().toISOString() }
        : { key, ruleId: r.id, ruleTitle: r.title, level, at: new Date().toISOString(), evidence, status: 'open', seen: 1 }
      all[key] = rec
      out.push(rec)
    }
  }
  const seen = new Set(out.map((x) => x.key))
  const cutoff = Date.now() - 7 * 86400 * 1000
  for (const [k, f] of Object.entries(all)) {
    if (seen.has(k) || f.status !== 'open') continue
    const last = Date.parse(f.lastSeen || f.at || '') || 0
    if (last && last < cutoff) { f.status = 'superseded'; f.updatedAt = new Date().toISOString() }
  }
  save(all)
  return out
}

export function setFindingStatus({ key, status, note } = {}) {
  if (!key || !STATUSES.includes(status)) return { ok: false, error: `status 必须是 ${STATUSES.join('|')}` }
  const all = loadFindings()
  const rec = all[key]
  if (!rec) return { ok: false, error: '没有找到这条发现' }
  rec.status = status
  if (note) rec.note = String(note).slice(0, 200)
  rec.updatedAt = new Date().toISOString()
  save(all)
  return { ok: true, finding: rec, statuses: STATUSES }
}

export function findingSummary(list) {
  const s = { total: list.length, open: 0, fixed: 0, accepted: 0, false_positive: 0, superseded: 0, red: 0, yellow: 0 }
  for (const f of list) {
    s[f.status] = (s[f.status] || 0) + 1
    if (f.level === 'red') s.red += 1
    else s.yellow += 1
  }
  return s
}
