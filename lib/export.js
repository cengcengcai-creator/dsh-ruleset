/**
 * 互操作：把 DSH 事实流导出成通用事件日志（JSONL），
 * 供 agent-rule-enforcement 的 audit_events.py 之类的离线审计器消费。
 *
 * 事件字段：ts(ISO) / session / tool / ok / duration_ms / checkpoint / outcome / user_visible / claims
 * 我们只填有把握的：checkpoint 用「轮内是否出现过收尾动作」近似，claims 留空（不猜）。
 */
export function exportEvents(facts) {
  const lines = []
  const bySeq = new Map((facts.commands || []).map((c) => [c.seq, c]))
  for (const t of facts.turns) {
    const calls = t.calls || []
    const tail = calls.slice(-3).map((c) => `${c.name} ${String(c.args?.command || c.args?.file_path || '')}`).join(' ')
    const checkpoint = /archive|归档|observe_report|session_projcache|\blint\b/.test(tail)
    if (calls.length === 0) continue
    for (const c of calls) {
      const cmd = bySeq.get(c.seq)
      const started = cmd?.startedAt || t.startTime || Date.now()
      const ended = cmd?.endAt && cmd.endAt > started ? cmd.endAt : started
      lines.push(JSON.stringify({
        ts: new Date(started).toISOString(),
        session: t.session,
        tool: c.name,
        ok: !(cmd?.isError === true),
        duration_ms: ended - started,
        checkpoint,
        outcome: 'ok',
        user_visible: false,
      }))
    }
  }
  return lines.join('\n')
}
