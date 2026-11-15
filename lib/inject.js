/** 注入层：把 policy 组装成 systemPrompt 段落。无 policy 时明确说「未加载」，不假装没规则。 */
export function composeSection(mode, policy) {
  if (mode === 'off') return ''
  const rules = Array.isArray(policy?.rules) ? policy.rules : []
  const L = ['# 工作标准（dsh-ruleset 注入，来自 policy）']
  if (rules.length === 0) {
    L.push('- (未找到 policy：规则未加载，视为 unknown，不要假设没有规则)')
    return L.join('\n')
  }
  for (const r of rules) {
    L.push(`- [${r.kind || 'protocol'}] ${r.title || r.id}：${r.text || ''}`)
    if (mode === 'full' && r.mechanism) L.push(`  - 机制：${r.mechanism}`)
  }
  return L.join('\n')
}
