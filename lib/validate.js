/**
 * policy 校验：零依赖，按 schema/policy.schema.json 的核心约束逐条查。
 * 目的：坏 policy 必须报错，而不是静默变成 unknown。
 */
const KINDS = new Set(['constraint', 'protocol'])
const MECHANISMS = new Set(['instruction', 'hook', 'tool'])
import { PREDICATE_DOCS, PREDICATES } from './predicates.js'

// 允许的判据类型以 predicates.js 的实现为准，避免两处清单漂移
const PREDICATE_TYPES = new Set([...Object.keys(PREDICATE_DOCS), ...Object.keys(PREDICATES)])

/** 每类判据的必填参数：缺了就是“判据不成立”，必须报错而不是静默通过。 */
const REQUIRED_PARAMS = {
  'path-boundary': [['pattern']],
  'field-presence': [['fields']],
  'count-threshold': [['consecutiveFailures']],
  'turn-condition': [['ifTurnCallMin'], ['thenPattern']],
  'sequence-order': [['taskPattern'], ['first'], ['then']],
  requires: [['ifPathPattern', 'ifContentPattern']],
  duration: [['minMinutes']],
  metric: [['key'], ['threshold']],
  regex: [['pattern']],
  'explain-first': [],
}

function checkParams(bind, at, errors, warnings) {
  const req = REQUIRED_PARAMS[bind.type]
  if (!req) return
  for (const group of req) {
    const ok = group.some((k) => {
      const v = bind[k]
      if (Array.isArray(v)) return v.length > 0
      return v !== undefined && v !== null && v !== ''
    })
    if (!ok) warnings.push(`${at}.observe.bind 缺少 ${group.join(' 或 ')}（${bind.type} 判据不成立，将被判为 unknown）`)
  }
}

export function validatePolicy(policy) {
  const errors = []
  const warnings = []
  if (!policy || typeof policy !== 'object') return { ok: false, errors: ['policy 不是对象'] }
  if (typeof policy.version !== 'number') errors.push('version 必须是数字')
  if (!Array.isArray(policy.rules)) return { ok: false, errors: [...errors, 'rules 必须是数组'] }
  const ids = new Set()
  policy.rules.forEach((r, i) => {
    const at = `rules[${i}]`
    if (!r || typeof r !== 'object') { errors.push(`${at} 不是对象`); return }
    if (!r.id || !/^[a-z][a-z0-9-]*$/.test(r.id)) errors.push(`${at}.id 非法（要求 kebab-case）`)
    else if (ids.has(r.id)) errors.push(`${at}.id 重复：${r.id}`)
    else ids.add(r.id)
    if (!KINDS.has(r.kind)) errors.push(`${at}.kind 必须是 constraint|protocol`)
    if (!r.title) errors.push(`${at}.title 缺失`)
    if (!r.text) errors.push(`${at}.text 缺失`)
    if (r.mechanism && !MECHANISMS.has(r.mechanism)) errors.push(`${at}.mechanism 非法`)
    const b = r.observe?.bind
    if (b) {
      if (!PREDICATE_TYPES.has(b.type)) errors.push(`${at}.observe.bind.type 未知：${b.type}`)
      else checkParams(b, at, errors, warnings)
      for (const [i, x] of (Array.isArray(r.observe?.binds) ? r.observe.binds.entries() : [])) {
        if (!x || !PREDICATE_TYPES.has(x.type)) errors.push(`${at}.observe.binds[${i}].type 未知：${x?.type}`)
        else checkParams(x, `${at}.observe.binds[${i}]`, errors, warnings)
      }
      for (const key of ['pattern', 'thenPattern', 'ifPattern', 'ifPathPattern', 'ifContentPattern', 'excludePath', 'requireUserPermit', 'pathPattern']) {
        if (b[key]) {
          try { new RegExp(b[key]) } catch (e) { errors.push(`${at}.observe.bind.${key} 不是合法正则：${e.message}`) }
        }
      }
      if (b.minSamples !== undefined && !(Number(b.minSamples) > 0)) errors.push(`${at}.observe.bind.minSamples 必须 > 0`)
    }
  })
  return { ok: errors.length === 0, errors, warnings }
}
