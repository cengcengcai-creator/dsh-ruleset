/**
 * 从 AGENTS.md 抽取候选规则（draft），按「可执行性三档」分类：
 *   产物要求 > 过程要求 > 态度要求
 * 输出永远是 draft：每条带原文行号与分类，必须人工确认后才进 policy。
 */
const FORCE = /必须|不得|禁止|严禁|一律|不允许|只能/
const FIELDish = /必须包含|首部|字段|章节|模板/
const COUNTish = /\d+\s*(?:次|分钟|秒|行|字符|%|条|轮)/
const CMDish = /`[^`]*(?:scripts?\/|\.sh|\.py|\.mjs)[^`]*`|跑\s*`|执行\s*`/
const SEMANTICish = /拿不准|先问|判断|思考|觉得|态度|原则|尽量|优先/

const slug = (line, i) => `agents-l${line}-${i}`

/** 解析一句规则描述 → 分类 + 建议判据（抽取器与面板共用同一套口径）。 */
export function parseSentence(line) {
  const t = String(line || '').trim()
  if (!t) return { classification: 'empty', bind: null }
  const fields = (t.match(/「([^」]{1,20})」/g) || []).map((s) => s.slice(1, -1))
  let classification = 'process'
  let bind = null
  if (FIELDish.test(t)) {
    classification = 'field'
    bind = fields.length
      ? { type: 'field-presence', ext: '.md', fields }
      : { type: 'field-presence', ext: '.md', fields: ['type'] }
  } else if (/删除|rm\b|清空/.test(t)) {
    classification = 'path'
    bind = { type: 'path-boundary', pattern: 'rm\\s+-rf', requireApproval: true }
  } else if (COUNTish.test(t)) {
    classification = 'count'
    const times = t.match(/(\d+)\s*次/)
    const mins = t.match(/(\d+)\s*分钟/)
    const pct = t.match(/(\d+(?:\.\d+)?)\s*%/)
    const perTurn = /单轮|每轮|一轮|轮内/.test(t)
    if (times && perTurn) bind = { type: 'turn-condition', ifTurnCallMin: Number(times[1]), thenPattern: 'observe_report|archive|归档|lint' }
    else if (times) bind = { type: 'count-threshold', consecutiveFailures: Number(times[1]) }
    else if (mins) bind = { type: 'duration', minMinutes: Number(mins[1]) }
    else if (pct) bind = { type: 'metric', key: 'context_ratio', op: '<=', threshold: Number(pct[1]) / 100 }
  } else if (/先查|先搜|先看外部|外部检索|检索|类似实例|类似案例|借鉴|闭门造车/.test(t)) {
    classification = 'search-first'
    bind = {
      type: 'sequence-order',
      taskPattern: '报错|错误|失败|为什么|排查|异常|崩|打不开|超时|error|fail|bug|debug|开发|实现',
      first: ['web_search', 'web_fetch'],
      then: ['read', 'grep', 'glob'],
      minSamples: 10,
    }
  } else if (/先[^。；]{0,12}(解释|说明|讲清|告知)/.test(t) || /(解释|说明)[^。；]{0,12}(原因|计划|方案|思路)/.test(t)) {
    classification = 'explain-first'
    bind = { type: 'explain-first' }
  } else if (/外发|上传|推送|发帖|邮件/.test(t)) {
    classification = 'outbound'
    bind = { type: 'regex', sources: ['commands'], pattern: 'git\\s+push|curl[^;|]*(-X\\s+POST|--data)|(?:sendmail|mail\\s+-s)', requireApproval: true }
  } else if (CMDish.test(t)) {
    classification = 'artifact'
  } else if (SEMANTICish.test(t)) {
    classification = 'semantic'
  }
  return { classification, bind, text: t }
}

export function extractFromAgents(text, file = 'AGENTS.md') {
  const lines = String(text).split('\n')
  const cands = []
  lines.forEach((raw, idx) => {
    const line = raw.trim()
    if (!line || !FORCE.test(line)) return
    if (/^[-*]\s*\[[ x]\]/.test(line)) return // 复选框不算规则正文
    const n = idx + 1
    let cls = 'process' // 过程要求：可检测但需人工确认怎么测
    let bind = null
    const fields = (line.match(/「([^」]{1,20})」/g) || []).map((s) => s.slice(1, -1))
    if (FIELDish.test(line)) {
      cls = 'field'
      bind = fields.length
        ? { type: 'field-presence', ext: '.md', fields }
        : { type: 'field-presence', ext: '.md', fields: ['type'] }
    } else if (COUNTish.test(line)) {
      cls = 'count'
      const times = line.match(/(\d+)\s*次/)
      const mins = line.match(/(\d+)\s*分钟/)
      if (times) bind = { type: 'turn-condition', ifTurnCallMin: Number(times[1]), thenPattern: 'observe_report|archive|归档|lint' }
      else if (mins) bind = { type: 'duration', minMinutes: Number(mins[1]) }
    } else if (CMDish.test(line)) {
      cls = 'artifact'
    } else if (SEMANTICish.test(line)) {
      cls = 'semantic'
    }
    cands.push({
      id: slug(n, cands.length),
      kind: 'protocol',
      title: line.replace(/^#+\s*/, '').slice(0, 40),
      text: line.replace(/\s+/g, ' ').slice(0, 200),
      observe: { metric: `agents_l${n}`, proposed: true },
      draft: { classification: cls, suggestedBind: bind, source: `${file}:${n}` },
    })
  })
  return {
    file,
    total: cands.length,
    byClass: cands.reduce((acc, c) => { acc[c.draft.classification] = (acc[c.draft.classification] || 0) + 1; return acc }, {}),
    rules: cands,
  }
}
