/**
 * 注入去重：DSH 本身会注入工作区 AGENTS.md。
 * 规则文本若已经出现在 AGENTS.md 里，就不再重复注入（但照常参与判定）。
 * 只读，不写任何用户文件 —— 拔掉插件后 prompt 与 AGENTS.md 原样。
 */
const norm = (s) => String(s || '')
  .replace(/[`*_#>]/g, '')
  .replace(/\s+/g, '')
  .toLowerCase()

export function dedupeRules(rules, agentsText) {
  const hay = norm(agentsText)
  if (!hay) return { kept: rules, skipped: [] }
  const kept = []
  const skipped = []
  for (const r of rules) {
    const probe = norm(r.text).slice(0, 40)
    if (probe && hay.includes(probe)) skipped.push(r)
    else kept.push(r)
  }
  return { kept, skipped }
}
