/** 规则理解：让模型说清「规定什么 / 审计什么 / 对象是什么 / 能否机械化」。 */
const SYSTEM = [
  '你在做规则审计设计。给你一条工作纪律，输出 JSON：',
  '{"object":"<审计对象，如 命令/文件写入/轮次>","trigger":"<什么条件下检查>","expectation":"<期望动作或字段>","exceptions":"<例外>","mechanical":true|false,"bind":{"type":"...","...":...}|null,"why":"<一句话>"}',
  'bind 只能用这些类型：path-boundary, field-presence, count-threshold, turn-condition, sequence-order, requires, duration, metric, regex, never, per-turn-cap, wal, change-gate, bypass, explain-first, doc-refs。',
  '只有真能机械核对时才给 bind；对象不明确的，mechanical=false 且 bind=null。',
].join('\n')

function collect(chunks) {
  let out = ''
  for (const c of chunks) {
    if (!c) continue
    if (typeof c.text === 'string') out += c.text
    else if (typeof c.delta === 'string') out += c.delta
  }
  return out
}

export async function introspectRule(context, rule, { timeoutMs = 20000 } = {}) {
  const llm = context?.get?.('llm')
  if (!llm) return { error: 'llm 不可用' }
  let provider, model
  try {
    const providers = llm.listProviders() || []
    provider = providers[0]?.provider || providers[0]?.id || providers[0]?.name
    const models = await llm.listModels(provider)
    model = models?.[0]?.id || models?.[0]?.model
  } catch (e) { return { error: 'discover: ' + (e?.message || e) } }
  if (!provider || !model) return { error: 'no provider/model' }
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const prepared = await llm.prepareCall({ provider, model, maxTokens: 400, reasoningEffort: 'off' }, ac.signal)
    let text = ''
    for await (const c of prepared.stream({ ...prepared.config, system: SYSTEM, messages: [{ role: 'user', content: [{ type: 'text', text: `规则名：${rule.title || rule.id}\n正文：${String(rule.text || '').slice(0, 500)}` }] }], signal: ac.signal })) {
      if (c?.type === 'finish') break
      text += collect([c])
    }
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return { error: 'no json', raw: text.slice(0, 120) }
    const parsed = JSON.parse(m[0])
    return {
      id: rule.id,
      object: String(parsed.object || '').slice(0, 60),
      trigger: String(parsed.trigger || '').slice(0, 120),
      expectation: String(parsed.expectation || '').slice(0, 120),
      exceptions: String(parsed.exceptions || '').slice(0, 80),
      mechanical: Boolean(parsed.mechanical),
      bind: parsed.bind && parsed.bind.type ? parsed.bind : null,
      why: String(parsed.why || '').slice(0, 160),
    }
  } catch (e) {
    return { error: e?.message || String(e) }
  } finally { clearTimeout(timer) }
}
