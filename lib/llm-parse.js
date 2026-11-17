/**
 * 用宿主模型把「一句话规则」拆成可执行判据；失败时上层回落到启发式。
 * 只读调用，不写文件。
 */
const SYSTEM = [
  '你把一句用户写的工作纪律，转成一条可机械检查的规则。只输出 JSON。',
  '不要假设用户场景；所有参数都必须来自这句话本身。缺参数就放进 missing，不要瞎填。',
  '输出：{"classification":"<短标签>","bind":{...}|null,"missing":["<参数名>"],"question":"<最多一句>","explain":"<给用户的一句白话解释>","alternatives":[{"type":"<判据类型>","bind":{...},"say":"<这条规则实际会检查什么>","why":"<为什么这样拆>"}]}',
  '可用的判据机制（bind.type）与参数：',
  '0) explain-first：动手（调用工具）之前必须先解释原因与计划，无参数。凡“先解释再操作”“说明计划后再执行”这类都归此类。',
  '1) path-boundary：命令删除了某类路径且未被允许。参数 pattern（JS 正则，匹配命令）、requireApproval（bool）、exemptPaths（数组，可空）',
  '2) field-presence：文件里缺少某些字段。参数 ext（如 .md）、fields（数组）、pathPattern（正则，可空）',
  '3) count-threshold：同一命令连续失败后仍重试。参数 consecutiveFailures（数字）',
  '4) turn-condition：某轮里必须出现某类动作。参数 ifTurnCallMin（数字）、thenPattern（正则）',
  '5) sequence-order：某类任务应先做 A 再做 B。参数 taskPattern（正则）、first（动作名数组）、then（动作名数组）、minSamples（数字）',
  '6) requires：做了 X 就必须伴随 Y。参数 ifPathPattern 或 ifContentPattern（正则）、minSamples（数字）',
  '7) duration：单次调用阻塞超过阈值。参数 minMinutes（数字）',
  '8) metric：某个平台指标超过阈值。参数 key（指标名）、op（<= 或 >=）、threshold（数字）',
  '9) regex：命令或写入内容中出现某模式。参数 sources（["commands"] 或 ["fileWrites"]）、pattern（正则）',
  '10) never：绝对禁止某内容（不论是否审批）。参数 sources、pattern（正则）',
  '11) per-turn-cap：单轮最多调用某工具几次。参数 toolPattern（正则）、maxPerTurn（数字）',
  '12) bypass：命令试图绕过权限/沙箱（sudo、越界写入、伪装执行）。参数 patterns（正则数组，可空用默认）',
  '13) change-gate：变更记录必须含指定章节。参数 pathPattern（正则）、sections（章节名数组）',
  '如果整句无法直接机械检查，但可以拆成若干可检查的子规则，bind 设为 null、classification 设 semantic，并在 alternatives 里给出 1-3 个可检查的替代（每个 {type,bind,say,why}）。',
  '禁止把拆解工作推回给用户：只要能想到合理拆法，就必须写进 alternatives，question 留空。',
  'question 只用于“缺少必要参数且无法从原句推断”的情况，且最多一句。',
  '例如“关键事实要有 ≥2 独立来源”可拆成 count-threshold 或 field-presence（要求记录里带 sources 字段与数量）。',
  '只要 classification 是 semantic，alternatives 就必须非空（至少 1 条）；只有连“拆成字段要求”都做不到时才可以空。',
  '常见拆法：来源要求→field-presence（fields: sources,url,retrieved_at）；数量下限→count-threshold 或 regex 匹配计数；禁止某动作→regex。',
  '正则用 JS 语法，尽量短；不要把用户没写的内容编进去。',
].join('\n')

function collectText(chunks) {
  let out = ''
  for (const c of chunks) {
    if (!c) continue
    if (typeof c.text === 'string') out += c.text
    else if (typeof c.delta === 'string') out += c.delta
  }
  return out
}

/** 语义类兜底：从句子关键词推测可检查的子规则，至少给出可落地的字段要求。 */
function heuristicAlternatives(text) {
  const t = String(text || '')
  const out = []
  if (/来源|URL|链接|检索时间|出处/.test(t)) {
    out.push({
      type: 'field-presence',
      bind: { type: 'field-presence', ext: '.md', fields: ['sources', 'url', 'retrieved_at'] },
      say: '要求调研记录里必须写清来源列表、来源 URL、检索时间三个字段',
      why: '把“要可追溯”落成可检查的字段',
    })
  }
  const m = t.match(/(\d+)\s*(?:个|条)?\s*(?:独立)?(?:来源|渠道)/)
  if (m) {
    out.push({
      type: 'regex',
      bind: { type: 'regex', sources: ['fileWrites'], pattern: '(?s)来源.{0,200}' },
      say: `检查记录里是否列出来源条目（至少 ${m[1]} 条）`,
      why: '数量下限需要记录格式配合，先检查结构存在',
    })
  }
  if (!out.length) {
    out.push({
      type: 'field-presence',
      bind: { type: 'field-presence', ext: '.md', fields: ['type', '判定依据'] },
      say: '要求交付记录里必须出现判定依据字段',
      why: '先保证记录自包含，再谈更细的检查',
    })
  }
  return out.slice(0, 3)
}

export async function parseWithLlm(context, text, { timeoutMs = 12000 } = {}) {
  const llm = context?.get?.('llm')
  if (!llm || typeof llm.listProviders !== 'function') return { error: 'llm service not reachable' }
  let provider
  let model
  try {
    const providers = llm.listProviders() || []
    provider = providers[0]?.provider || providers[0]?.id || providers[0]?.name
    if (!provider) return { error: 'no provider' }
    const models = await llm.listModels(provider)
    model = models?.[0]?.id || models?.[0]?.model
    if (!model) return { error: 'no model' }
  } catch (e) { return { error: 'discover: ' + (e?.message || String(e)) } }

  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const prepared = await llm.prepareCall({ provider, model, maxTokens: 500, reasoningEffort: 'off' }, ac.signal)
    const opts = {
      ...prepared.config,
      system: SYSTEM,
      messages: [{ role: 'user', content: [{ type: 'text', text }] }],
      signal: ac.signal,
    }
    const chunks = []
    for await (const c of prepared.stream(opts)) {
      if (c?.type === 'finish') break
      chunks.push(c)
    }
    const raw = collectText(chunks).trim()
    const m = raw.match(/\{[\s\S]*\}/)
    if (!m) return { error: 'no json in reply: ' + raw.slice(0, 80) }
    const parsed = JSON.parse(m[0])
    if (!parsed || typeof parsed !== 'object') return { error: 'bad json' }
    const bind = parsed.bind && typeof parsed.bind === 'object' ? parsed.bind : null
    let alternatives = Array.isArray(parsed.alternatives)
      ? parsed.alternatives.filter((a) => a && a.bind && a.bind.type).slice(0, 3).map((a) => ({
          type: String(a.type || a.bind.type), bind: a.bind,
          say: String(a.say || '').slice(0, 120), why: String(a.why || '').slice(0, 120),
        }))
      : []
    if (!alternatives.length && String(parsed.classification) === 'semantic') alternatives = heuristicAlternatives(text)
    return {
      classification: String(parsed.classification || 'process'),
      bind,
      missing: Array.isArray(parsed.missing) ? parsed.missing : [],
      question: typeof parsed.question === 'string' ? parsed.question.slice(0, 120) : '',
      explain: typeof parsed.explain === 'string' ? parsed.explain.slice(0, 200) : '',
      alternatives,
      by: 'llm',
    }
  } catch (e) {
    return { error: 'call: ' + (e?.message || String(e)) }
  } finally {
    clearTimeout(timer)
  }
}
