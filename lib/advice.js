/**
 * 规则制定建议：把「长任务判据该怎么改」那类经验做成可复用的检查。
 * 依据（2026-11-24 那次修订的教训）：
 *  - 判据必须在“开工时”可求值，依赖本轮结束后的计数/时长 = 不可能当闸门
 *  - 豁免条件必须显式写在规则里，否则模型会自己找理由
 *  - 阈值必须有来源，否则数字会漂
 *  - 对象必须收窄（pathPattern / excludePath），否则命中无关文件
 */

const POST_HOC = /结束时|本轮结束|事后|统计本|累计|总时长|超过.*秒后|跑完/
const HAS_EXEMPT = /豁免|例外|除非|短任务|可以不做|免于/
const THRESHOLD = /\d+\s*(次|秒|分钟|小时|%|条)/

/** 分区建议：按“越界即事故 / 需机械判定 / 仅提示”判断该放哪一栏。 */
export function tierAdvice(rule) {
  const text = String(rule.text || '')
  const cur = rule.tier || (rule.kind === 'constraint' ? 'redline' : 'hard')
  const binds = Array.isArray(rule.observe?.binds) ? rule.observe.binds : (rule.observe?.bind ? [rule.observe.bind] : [])
  const redWords = /凭据|隐私|外发|删除|提权|sudo|绕过|泄漏|不得|禁止/
  let want = 'hard'
  let why = '需要机械判定，放硬约束'
  if (redWords.test(text) && (rule.kind === 'constraint' || /绝|任何例外/.test(text))) { want = 'redline'; why = '涉及不可越界的红线（凭据/隐私/破坏性/提权）' }
  else if (!binds.length) { want = 'soft'; why = '没有机械判据，只能作为提示，放软规则' }
  if (want === cur) return null
  return { level: 'info', code: 'tier', say: `建议放到「${want === 'redline' ? '红线' : want === 'hard' ? '硬约束' : '软规则'}」栏（当前在 ${cur}）`, fix: why, action: { kind: 'set-tier', tier: want } }
}

export function adviseRule(rule) {
  const text = String(rule.text || '')
  const binds = Array.isArray(rule.observe?.binds) ? rule.observe.binds : (rule.observe?.bind ? [rule.observe.bind] : [])
  const out = []
  const push = (level, code, say, fix, action) => out.push({ level, code, say, fix, action: action || null })

  if (!binds.length) {
    push('info', 'no-predicate', '这条没有机械判据，只会作为提示注入', '如果它其实可机械化，用「规则体检」的建议；否则保持仅提示', { kind: 'suggest-bind' })
  }

  for (const b of binds) {
    // 事后判据：靠本轮结束时才能算的数
    if ((b.type === 'turn-condition' || b.type === 'duration' || b.type === 'count-threshold') && POST_HOC.test(text)) {
      push('warn', 'post-hoc', `「${rule.title || rule.id}」依赖事后统计（本轮结束才知道的计数/时长），开工时无法判断，不能当闸门`, '改成开工即可求值的形式：如 declare-first（先声明计划），把计数/时长降级为事后验证器', { kind: 'replace-bind', bind: { type: 'declare-first', maxExemptCalls: 2 } })
    }
    // 豁免缺失
    if ((b.type === 'turn-condition' || b.type === 'declare-first') && !HAS_EXEMPT.test(text)) {
      push('warn', 'no-exemption', `「${rule.title || rule.id}」没有写豁免条件，模型会自己找理由跳过`, '显式写出豁免：单动作 + 无需外部取数 + ≤N 次调用，且豁免须说明理由', { kind: 'append-text', text: '（豁免：单动作、无需外部取数、预计≤2 次调用可免；豁免须写明理由）' })
    }
    // 对象未收窄
    if (b.type === 'field-presence' && !b.pathPattern && !b.excludesPath && !b.excludePath) {
      push('warn', 'no-scope', `「${rule.title || rule.id}」的字段检查没有限定文件范围，会命中所有 .md`, '补 pathPattern（如 notes|output|调研）与 excludePath（AGENTS|README|SKILL）', { kind: 'update-bind', patch: { pathPattern: '(^|/)(output|notes|records|reports)/|调研|research', excludePath: '(AGENTS|README|CLAUDE|SKILL)\\.md$' } })
    }
    // 阈值无来源
    if (THRESHOLD.test(text) && !/实测|校准|依据|来源|来自/.test(text)) {
      push('info', 'no-source', `「${rule.title || rule.id}」里的数字没有注明来源`, '补一句「阈值来自实测/校准」，否则以后没人敢改', { kind: 'append-text', text: '（阈值来源：实测/校准）' })
    }
    // metric 缺 key
    if (b.type === 'metric' && !b.key) push('error', 'metric-no-key', `「${rule.title || rule.id}」的 metric 缺 key`, '补 key（如 context_ratio）与方向 op', { kind: 'update-bind', patch: { key: 'context_ratio', op: '<=', threshold: 0.4 } })
  }
  const tier = tierAdvice(rule)
  if (tier) out.push(tier)
  return { id: rule.id, title: rule.title, tier: rule.tier, suggestions: out }
}

export function adviseAll(rules) {
  const items = []
  for (const r of rules) {
    const a = adviseRule(r)
    if (a.suggestions.length) items.push(a)
  }
  const count = (lv) => items.reduce((n, i) => n + i.suggestions.filter((s) => s.level === lv).length, 0)
  return { items, summary: { rules: rules.length, rulesWithAdvice: items.length, error: count('error'), warn: count('warn'), info: count('info') } }
}
