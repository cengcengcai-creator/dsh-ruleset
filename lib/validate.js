/**
 * policy 校验：零依赖，按 schema/policy.schema.json 的核心约束逐条查。
 * 目的：坏 policy 必须报错，而不是静默变成 unknown。
 */
const KINDS = new Set(['constraint', 'protocol'])
const MECHANISMS = new Set(['instruction', 'hook', 'tool'])
const PREDICATE_TYPES = new Set(['regex', 'path-boundary', 'field-presence', 'sequence-order', 'count-threshold', 'requires', 'turn-condition', 'duration', 'metric'])

export function validatePolicy(policy) {
  const errors = []
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
      for (const key of ['pattern', 'thenPattern', 'ifPattern', 'ifPathPattern', 'ifContentPattern', 'excludePath', 'requireUserPermit', 'pathPattern']) {
        if (b[key]) {
          try { new RegExp(b[key]) } catch (e) { errors.push(`${at}.observe.bind.${key} 不是合法正则：${e.message}`) }
        }
      }
      if (b.minSamples !== undefined && !(Number(b.minSamples) > 0)) errors.push(`${at}.observe.bind.minSamples 必须 > 0`)
    }
  })
  return { ok: errors.length === 0, errors }
}
