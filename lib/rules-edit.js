/** 规则编辑：只在用户从面板显式提交时写 policy.yaml；写前备份、写后校验。 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { validatePolicy } from './validate.js'
import { resolveRuleSource } from './source.js'
import { backupPolicy } from './backups.js'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

export function policyFile() {
  return path.join(process.env.HOME || '', '.dsh', 'workspace', 'policy.yaml')
}

export function listRules() {
  const src = resolveRuleSource('')
  const rules = (src.policy?.rules || []).map((r) => ({
    id: r.id, kind: r.kind, title: r.title, text: r.text,
    predicate: r.observe?.bind?.type || null,
    bind: r.observe?.bind || null,
  }))
  return { file: src.file, kind: src.kind, draft: src.kind === 'agents-draft', rules }
}

export function addRule({ id, title, text, kind = 'protocol', bind, binds, tier } = {}) {
  if (!id || !/^[a-z][a-z0-9-]*$/.test(id)) return { ok: false, error: 'id 必须是 kebab-case' }
  if (!title || !text) return { ok: false, error: 'title 与 text 必填' }
  const file = policyFile()
  let policy
  try { policy = yaml.load(fs.readFileSync(file, 'utf8')) } catch { policy = { version: 1, rules: [] } }
  if (!policy || !Array.isArray(policy.rules)) policy = { version: 1, rules: [] }
  if (policy.rules.some((r) => r.id === id)) return { ok: false, error: `规则 ${id} 已存在` }
  const norm = (x) => String(x || '').replace(/\s+/g, '').trim()
  if (policy.rules.some((r) => norm(r.text) === norm(text) || norm(r.title) === norm(title))) {
    return { ok: false, error: '已经有内容相同的规则了，不重复创建' }
  }
  const rule = { id, kind, title, text, tier: ['redline','hard','soft'].includes(tier) ? tier : 'hard', observe: { metric: id.replace(/-/g, '_') } }
  const list = Array.isArray(binds) ? binds.filter((b) => b && b.type) : []
  if (list.length > 1) rule.observe.binds = list
  else if (list.length === 1) rule.observe.bind = list[0]
  else if (bind && bind.type) rule.observe.bind = bind
  policy.rules.push(rule)
  const v = validatePolicy(policy)
  if (!v.ok) return { ok: false, error: v.errors.join('; ') }
  try {
    backupPolicy('add-rule')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, yaml.dump(policy, { noRefs: true, lineWidth: 200 }))
  } catch (e) { return { ok: false, error: `写入失败：${e.message}` } }
  return { ok: true, file, total: policy.rules.length, rule }
}

export function updateRule({ id, title, text, bind, binds } = {}) {
  if (!id) return { ok: false, error: '缺少 id' }
  const file = policyFile()
  let policy
  try { policy = yaml.load(fs.readFileSync(file, 'utf8')) } catch { return { ok: false, error: 'policy.yaml 读不出来' } }
  if (!policy || !Array.isArray(policy.rules)) return { ok: false, error: 'policy.yaml 结构异常' }
  const rule = policy.rules.find((r) => r.id === id)
  if (!rule) return { ok: false, error: `没有找到规则 ${id}` }
  if (title) rule.title = title
  if (text) rule.text = text
  if (Array.isArray(binds)) {
    const list = binds.filter((b) => b && b.type)
    const next = { ...(rule.observe || {}) }
    delete next.binds
    delete next.bind
    if (list.length > 1) next.binds = list
    else if (list.length === 1) next.bind = list[0]
    rule.observe = next
  } else if (bind && bind.type) rule.observe = { ...(rule.observe || {}), bind }
  const v = validatePolicy(policy)
  if (!v.ok) return { ok: false, error: v.errors.join('; ') }
  try {
    backupPolicy('write')
    fs.writeFileSync(file, yaml.dump(policy, { noRefs: true, lineWidth: 200 }))
  } catch (e) { return { ok: false, error: `写入失败：${e.message}` } }
  return { ok: true, rule }
}

export function setTier({ id, tier } = {}) {
  const TIERS = ['redline', 'hard', 'soft']
  if (!id || !TIERS.includes(tier)) return { ok: false, error: `tier 必须是 ${TIERS.join('|')}` }
  const file = policyFile()
  let policy
  try { policy = yaml.load(fs.readFileSync(file, 'utf8')) } catch { return { ok: false, error: 'policy.yaml 读不出来' } }
  const rule = (policy.rules || []).find((r) => r.id === id)
  if (!rule) return { ok: false, error: `没有找到规则 ${id}` }
  rule.tier = tier
  try {
    backupPolicy('write')
    fs.writeFileSync(file, yaml.dump(policy, { noRefs: true, lineWidth: 200 }))
  } catch (e) { return { ok: false, error: `写入失败：${e.message}` } }
  return { ok: true, id, tier }
}

export function removeRule({ id } = {}) {
  if (!id) return { ok: false, error: '缺少 id' }
  const file = policyFile()
  let policy
  try { policy = yaml.load(fs.readFileSync(file, 'utf8')) } catch { return { ok: false, error: 'policy.yaml 读不出来' } }
  if (!policy || !Array.isArray(policy.rules)) return { ok: false, error: 'policy.yaml 结构异常' }
  const before = policy.rules.length
  policy.rules = policy.rules.filter((r) => r.id !== id)
  if (policy.rules.length === before) return { ok: false, error: `没有找到规则 ${id}` }
  const v = validatePolicy(policy)
  if (!v.ok) return { ok: false, error: v.errors.join('; ') }
  try {
    backupPolicy('write')
    fs.writeFileSync(file, yaml.dump(policy, { noRefs: true, lineWidth: 200 }))
  } catch (e) { return { ok: false, error: `写入失败：${e.message}` } }
  return { ok: true, removed: id, total: policy.rules.length }
}

export function dedupeRules() {
  const file = policyFile()
  let policy
  try { policy = yaml.load(fs.readFileSync(file, 'utf8')) } catch { return { ok: false, error: 'policy.yaml 读不出来' } }
  if (!policy || !Array.isArray(policy.rules)) return { ok: false, error: 'policy.yaml 结构异常' }
  // 同组里优先保留“有判据”的那条，其次保留最早出现的
  const groups = new Map()
  for (const r of policy.rules) {
    const k = `${String(r.title || '').trim()}|${String(r.text || '').trim()}`
    const cur = groups.get(k)
    if (!cur) { groups.set(k, r); continue }
    const curHas = Boolean(cur.observe?.bind)
    const newHas = Boolean(r.observe?.bind)
    if (!curHas && newHas) groups.set(k, r)
  }
  const kept = [...groups.values()]
  const removed = policy.rules.length - kept.length
  if (removed === 0) return { ok: true, removed: 0, total: kept.length }
  policy.rules = kept
  try {
    backupPolicy('write')
    fs.writeFileSync(file, yaml.dump(policy, { noRefs: true, lineWidth: 200 }))
  } catch (e) { return { ok: false, error: `写入失败：${e.message}` } }
  return { ok: true, removed, total: kept.length }
}
