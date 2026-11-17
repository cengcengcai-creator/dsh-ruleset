/** 注入层：把 policy 组装成 systemPrompt 段落（标准化格式，便于 agent 照着执行）。 */
import { explainBind } from './explain.js'

const SHORT_SAY = {
  'explain-first': '动手前须先解释',
  'path-boundary': '删除类命令需先确认',
  'field-presence': '文件须含指定字段',
  'count-threshold': '连续失败后仍重试算违规',
  'turn-condition': '长任务须出现指定动作',
  'sequence-order': '先检索再动手',
  requires: '做了 X 须伴随 Y',
  duration: '阻塞超时须后台化',
  wal: '收到指令后须及时落盘',
  never: '绝对禁止项',
  bypass: '禁止绕过沙箱',
  'approval-gated': '敏感命令须经 DSH 审批',
  'permission-change': '权限变更须当轮解释',
  'job-dangling': '后台任务须结算',
  'command-audit': '斜杠命令须完成',
  'change-gate': '变更记录须含必需章节',
  'per-turn-cap': '单轮调用上限',
  metric: '指标阈值',
  regex: '内容/命令模式匹配',
}

const paramSummary = (bind) => {
  if (!bind) return ''
  const parts = []
  for (const [k, v] of Object.entries(bind)) {
    if (k === 'type' || v === undefined || v === null) continue
    if (Array.isArray(v)) { if (v.length) parts.push(`${k}=${v.join('/')}`) ; continue }
    parts.push(`${k}=${v}`)
  }
  return parts.join(' ')
}

export function composeSection(mode, policy) {
  if (mode === 'off') return ''
  const rules = Array.isArray(policy?.rules) ? policy.rules : []
  const L = [
    '# 工作标准（dsh-ruleset 注入，来自 policy）',
    '格式：`- [类别] 规则名｜要求：原文｜判定：可检查方式（无判据则为“仅提示”）`。判定由插件机械执行，你只需按要求做。',
  ]
  if (rules.length === 0) {
    L.push('- (未找到 policy：规则未加载，视为 unknown，不要假设没有规则)')
    return L.join('\n')
  }
  const TIER_TITLE = { redline: '红线（不可越界）', hard: '硬约束（会被判定）', soft: '软规则（仅提示或统计）' }
  const TIER_ORDER = ['redline', 'hard', 'soft']
  for (const tier of TIER_ORDER) {
    const group = rules.filter((r) => (r.tier || (r.kind === 'constraint' ? 'redline' : 'hard')) === tier)
    if (!group.length) continue
    L.push('', `## ${TIER_TITLE[tier]}`)
    for (const r of group) {
      const binds = Array.isArray(r.observe?.binds) ? r.observe.binds : (r.observe?.bind ? [r.observe.bind] : [])
      const judge = binds.length
        ? binds.map((b) => `${b.type}（${SHORT_SAY[b.type] || '可检查'}）`).join(' + ')
        : '仅提示（不判定）'
      const tail = mode === 'full' && binds.length ? ` → ${binds.map((b) => explainBind(b)).join('；')}` : ''
      L.push(`- [${r.kind || 'protocol'}] ${r.title || r.id}｜要求：${r.text || ''}｜判定：${judge}${tail}`)
    }
  }
  return L.join('\n')
}
