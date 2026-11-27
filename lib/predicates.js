/**
 * 六类谓词执行器：规则在 policy 里声明用哪个谓词，这里统一执行。
 * 判据不写在代码里；新增规则 = 改 policy。
 */
import { isInside } from './facts.js'

const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ')

/** 取用户原话里最像需求的一行（去掉 system-reminder / Time sampled 之类噪声）。 */
const NOISE_SUB = [/Time sampled[^\n]*/gi, /Elapsed since[^\n]*/gi, /Browser time zone[^\n]*/gi, /Tokens prefixed[^\n]*/gi, /<system-reminder>[\s\S]*?<\/system-reminder>/gi, /Current DeepSeek Harness[^\n]*/gi]

/** 取用户原话里最像需求的一句（去掉系统注入文本）。 */
function userLine(t) {
  let text = String(t.user || '')
  for (const re of NOISE_SUB) text = text.replace(re, ' ')
  const parts = text.split(/[\n。！？]/).map((x) => x.trim()).filter((x) => x.length >= 4)
  const cjk = parts.filter((x) => /[\u4e00-\u9fa5]/.test(x))
  const pick = (cjk.length ? cjk : parts).sort((a, b) => b.length - a.length)[0] || ''
  return pick.replace(/\s+/g, ' ').slice(0, 70)
}

const when = (ms) => {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 平台临时区：沙箱允许写，删除脚手架不算破坏性资产操作（可用 strictTemp 关掉）
const TEMP_PREFIXES = ['/tmp/', '/private/tmp/', '/var/folders/', '/private/var/folders/']
function isTempPath(p, bind) {
  if (bind?.strictTemp) return false
  const prefixes = Array.isArray(bind?.exemptPaths) && bind.exemptPaths.length ? bind.exemptPaths : TEMP_PREFIXES
  return prefixes.some((pre) => String(p).startsWith(pre))
}

function insideCount(cmd) {
  const inside = cmd.targets.some((t) => isInside(cmd.cwd, t) === true)
  const outside = cmd.targets.some((t) => isInside(cmd.cwd, t) === false)
  return { inside, outside }
}

/** 统一结果：hits / base / rate，对齐上游「分母式」口径。 */
function result(hits, base, samples = []) {
  const status = base === 0 ? 'unknown' : (hits > 0 ? 'violation' : 'pass')
  const rate = base === 0 ? null : Math.round((hits / base) * 1000) / 1000
  const detail = base === 0 ? '无样本' : `${hits}/${base}${rate === null ? '' : `（${Math.round(rate * 100)}%）`}`
  return { status, hits, base, rate, detail, samples: samples.slice(0, 3) }
}

/** 判据说明：面板据此生成下拉与参数表单（一份真源，别在 UI 里另抄）。 */
export const PREDICATE_DOCS = {
  'explain-first': { say: '动手（调工具）之前没有先解释原因与计划', params: [] },
  'path-boundary': { say: '命令删除了工作区外的路径且没先确认', params: ['pattern', 'requireApproval', 'exemptPaths'] },
  'field-presence': { say: '文件里缺少指定字段', params: ['ext', 'fields', 'pathPattern', 'excludePath', 'legacyDays'] },
  'count-threshold': { say: '同一命令连续失败后仍在重试', params: ['consecutiveFailures', 'minSamples'] },
  'turn-condition': { say: '长任务里没有出现指定动作', params: ['ifTurnCallMin', 'ifTurnDurationSec', 'graceSec', 'thenPattern', 'thenFilePattern'] },
  wal: { say: '收到指令后没有及时落盘', params: ['withinSec', 'thenFilePattern'] },
  'sequence-order': { say: '诊断/开发任务没先查外部就动手', params: ['taskPattern', 'first', 'then', 'minSamples'] },
  'requires': { say: '做了 X 就必须有 Y（如高风险交付要有独立复核）', params: ['ifPathPattern', 'ifContentPattern', 'minSamples'] },
  'duration': { say: '单次调用阻塞超过阈值且没后台化', params: ['minMinutes'] },
  'metric': { say: '指标超过阈值', params: ['key', 'op', 'threshold'] },
  'regex': { say: '命令或写入内容里出现指定模式', params: ['sources', 'pattern', 'target', 'requireWrite'] },
  never: { say: '绝对禁止某类内容出现（命中即违规）', params: ['sources', 'pattern'] },
  bypass: { say: '命令尝试绕过沙箱/权限边界', params: ['patterns'] },
  'approval-gated': { say: '敏感命令没有经过 DSH 审批就执行', params: ['patterns'] },
  'permission-change': { say: '权限档位变更时没有当轮解释', params: [] },
  'declare-first': { say: '开工前没有先声明计划（短任务可豁免）', params: ['maxExemptCalls', 'planPattern'] },
  'phase-gap': { say: '阶段推进时长时间没有任何说明', params: ['minMinutes'] },
  'job-dangling': { say: '后台任务没有正常结算', params: ['minMinutes'] },
  'command-audit': { say: '斜杠命令没有走到完成', params: [] },
  'change-gate': { say: '变更记录缺少必需章节', params: ['pathPattern', 'sections', 'ext'] },
  'per-turn-cap': { say: '单轮最多调用某工具几次', params: ['toolPattern', 'maxPerTurn'] },
}

const compile = (pattern, flags = '') => {
  const src = String(pattern || '').replace(/^\(\?s\)/, '').replace(/\(\?s\)/g, '')
  const needDotAll = /^\(\?s\)/.test(String(pattern || '')) || String(pattern || '').includes('(?s)')
  try { return new RegExp(src, needDotAll ? `${flags}s`.replace(/[^gimsuy]/g, '') : flags) } catch { return null }
}

export const PREDICATES = {
  /** 绝对禁止：命中即违规，不因审批而豁免（OPA deny 语义）。 */
  never: (facts, b) => {
    const re = compile(b.pattern)
    if (!re) return { status: 'unknown', hits: 0, base: 0, rate: null, detail: '正则无法编译', samples: [] }
    const src = Array.isArray(b.sources) ? b.sources : ['commands']
    const pool = []
    if (src.includes('commands')) for (const c of facts.commands) pool.push({ id: c.seq, text: c.cmd, session: c.session, atMs: c.startedAt, at: when(c.startedAt) })
    if (src.includes('fileWrites')) for (const w of facts.fileWrites) pool.push({ id: w.seq, text: w.content, session: w.session, path: w.path, atMs: w.mtimeMs, at: when(w.mtimeMs) })
    const hits = pool.filter((x) => re.test(String(x.text || '')))
    const r = result(hits.length, pool.length, hits.slice(0, 5))
    r.detail = `扫描 ${pool.length} 条，命中绝对禁止模式 ${hits.length} 条`
    return r
  },

  /** 单轮最多 N 次某类调用（OPA at-most 语义）。 */
  'per-turn-cap': (facts, b) => {
    const re = compile(b.toolPattern || '.')
    if (!re) return { status: 'unknown', hits: 0, base: 0, rate: null, detail: '正则无法编译', samples: [] }
    const cap = Number(b.maxPerTurn || 3)
    const turns = facts.turns.filter((t) => (t.calls || []).length)
    const bad = turns.filter((t) => t.calls.filter((c) => re.test(c.name)).length > cap)
    const r = result(bad.length, turns.length, bad.slice(0, 5))
    r.detail = `${turns.length} 轮里，${bad.length} 轮单轮调用超过 ${cap} 次`
    return r
  },

  'explain-first': (facts, b) => {
    const turns = facts.turns.filter((t) => (t.calls || []).length > 0)
    const hits = turns.filter((t) => !t.saidBeforeCall)
    const samples = hits.slice(0, 5).map((t) => ({ at: when(t.startTime), session: t.session, seq: t.seq, user: userLine(t), calls: (t.calls || []).length, atMs: t.startTime }))
    const r = result(hits.length, turns.length, samples)
    r.detail = `有工具调用的轮次里，${hits.length} 轮在第一次调用前没有解释文本`
    return r
  },
  /** 绕过检测：只看命令段开头是否是提权/伪装执行，避免匹配脚本正文里的字面量。 */
  bypass: (facts, b) => {
    const res = (Array.isArray(b.patterns) && b.patterns.length ? b.patterns : [
      '(?:^|[;&|]\\s*)(?:[A-Za-z_]+=\\S+\\s+)*sudo\\b',
      '(?:^|[;&|]\\s*)(?:[A-Za-z_]+=\\S+\\s+)*chmod\\s+777\\b',
      '(?:^|[;&|]\\s*)(?:[A-Za-z_]+=\\S+\\s+)*osascript\\b',
      'curl\\b[^;|]*\\|\\s*(?:ba)?sh\\b',
      '(?:^|[;&|]\\s*)(?:>|tee\\s+)\\s*/(?:etc|usr|System|Library)/',
      '\\blaunchctl\\s+(?:load|bootstrap)\\b[^;]*LaunchDaemons',
    ]).map((x) => compile(x, 'm')).filter(Boolean)
    const hits = facts.commands.filter((c) => res.some((re) => re.test(String(c.cmd || ''))))
    const samples = hits.slice(0, 5).map((c) => ({ at: when(c.startedAt), atMs: c.startedAt, session: c.session, cmd: String(c.cmd).slice(0, 90) }))
    const r = result(hits.length, facts.commands.length, samples)
    r.detail = `${facts.commands.length} 条命令里，${hits.length} 条命中绕过模式（只看命令段开头）`
    return r
  },

  /** 变更门：变更记录必须含指定章节（移植自 OpenClaw change-gate.py）。 */
  'change-gate': (facts, b) => {
    const re = compile(b.pathPattern || '变更|change|change-log')
    const sections = Array.isArray(b.sections) && b.sections.length ? b.sections : ['双评估', '落', '收尾']
    const legacyMs = Number(b.legacyDays || 7) * 86400 * 1000
    const files = facts.fileWrites.filter((w) => w.path.endsWith(b.ext || '.md') && (!re || re.test(w.path)) && !(w.mtimeMs && w.mtimeMs < Date.now() - legacyMs))
    const seen = new Map()
    for (const f of files) if (!seen.has(f.path)) seen.set(f.path, f)
    const bad = []
    for (const [p, f] of seen) {
      const lacks = sections.filter((x) => !String(f.content || '').includes(x))
      if (lacks.length) bad.push({ path: p, lacks, at: when(f.mtimeMs), atMs: f.mtimeMs })
    }
    const r = result(bad.length, seen.size, bad.slice(0, 5))
    r.detail = seen.size === 0 ? '没有匹配的变更记录' : `${seen.size} 份变更记录里，${bad.length} 份缺章节`
    return r
  },

  /** 权限档位变更必须当轮解释。 */
  'permission-change': (facts, b) => {
    const list = facts.permissionChanges || []
    const bad = list.filter((x) => !x.said)
    const samples = bad.slice(0, 5).map((x) => ({ at: x.at, atMs: x.atMs, session: x.session, extra: `${x.from} → ${x.to}` }))
    const r = result(bad.length, list.length, samples)
    r.detail = `权限档位变更 ${list.length} 次，其中 ${bad.length} 次当轮没有解释`
    return r
  },

  /** 后台任务必须有结算。 */
  'job-dangling': (facts, b) => {
    const limit = Number(b.minMinutes || 30) * 60000
    const list = facts.jobs || []
    const bad = list.filter((j) => !j.settledAt || (j.settledAt && j.settledAt - j.atMs > limit * 10))
    const samples = bad.slice(0, 5).map((j) => ({ at: j.at, atMs: j.atMs, session: j.session, extra: j.settledAt ? '结算过晚' : '未结算' }))
    const r = result(bad.length, list.length, samples)
    r.detail = `后台任务 ${list.length} 个，其中 ${bad.length} 个没有正常结算`
    return r
  },

  /** 斜杠命令必须走到完成。 */
  'command-audit': (facts, b) => {
    const list = facts.commandsRun || []
    const bad = list.filter((x) => !x.done)
    const samples = bad.slice(0, 5).map((x) => ({ at: x.at, atMs: x.atMs, session: x.session, extra: `/ ${x.name}` }))
    const r = result(bad.length, list.length, samples)
    r.detail = `斜杠命令 ${list.length} 次，其中 ${bad.length} 次没有完成记录`
    return r
  },

  /**
   * 开工声明（移植 OpenClaw 2026-11-24 版）：默认先声明计划，短任务才可豁免。
   * 豁免须同时满足：单动作 + 无需外部取数 + 预计调用 ≤2；且事后校验（事后补声不算覆盖）。
   */
  'declare-first': (facts, b) => {
    const planRe = compile(b.planPattern || '计划|步骤|我先|接下来|会先|打算|准备|方案')
    const maxExemptCalls = Number(b.maxExemptCalls || 2)
    const turns = facts.turns.filter((t) => !t.delegated && (t.calls || []).length > 0)
    const exempt = (t) => {
      const calls = (t.calls || []).length
      if (calls > maxExemptCalls) return false
      const single = calls === 1
      const noWrite = !(t.writes || []).length
      const noNet = !(t.calls || []).some((c) => c.name === 'web_search' || c.name === 'web_fetch')
      return single && noWrite && noNet
    }
    const declared = (t) => {
      if (!t.saidBeforeCall || !t.firstSaidAt) return false
      const firstCallAt = Math.min(...(t.calls || []).map((c) => c.at || Infinity).filter(Number.isFinite))
      if (!Number.isFinite(firstCallAt)) return false
      if (t.firstSaidAt > firstCallAt) return false
      return planRe ? planRe.test(String(t.user || '') + ' ' + String(t.saidText || '')) || true : true
    }
    const hits = []
    let exempted = 0
    for (const t of turns) {
      if (declared(t)) continue
      if (exempt(t)) { exempted += 1; continue }
      hits.push({ at: when(t.startTime), atMs: t.startTime, session: t.session, seq: t.seq, user: userLine(t), calls: (t.calls || []).length })
    }
    const r = result(hits.length, Math.max(0, turns.length - exempted), hits.slice(0, 5))
    r.detail = `${turns.length} 个有工具调用的轮次中，${exempted} 轮按豁免放行，${hits.length} 轮开工未声明`
    return r
  },

  /** 阶段间隔：同一轮内超过 N 分钟没有任何 assistant 输出即视为“静默推进”。 */
  'phase-gap': (facts, b) => {
    const limit = Number(b.minMinutes || 30) * 60000
    const turns = facts.turns.filter((t) => t.startTime && t.endTime && t.endTime - t.startTime > limit)
    const bad = []
    for (const t of turns) {
      const marks = [t.startTime, ...(t.saidAt || []), t.endTime].sort((x, y) => x - y)
      let gap = 0
      for (let i = 1; i < marks.length; i += 1) gap = Math.max(gap, marks[i] - marks[i - 1])
      if (gap > limit) bad.push({ at: when(t.startTime), atMs: t.startTime, session: t.session, seq: t.seq, extra: `最长静默 ${Math.round(gap / 60000)} 分钟`, calls: (t.calls || []).length })
    }
    const r = result(bad.length, turns.length, bad.slice(0, 5))
    r.detail = `${turns.length} 个超 ${Math.round(limit / 60000)} 分钟的轮次里，${bad.length} 轮出现超长静默`
    return r
  },

  /** 审批门：敏感命令必须留下 DSH 的审批痕迹（approval/asked|decided），否则视为绕过。 */
  'approval-gated': (facts, b) => {
    const res = (Array.isArray(b.patterns) && b.patterns.length ? b.patterns : [
      '(?:^|[;&|]\\s*)(?:[A-Za-z_]+=\\S+\\s+)*sudo\\b',
      '(?:^|[;&|]\\s*)(?:[A-Za-z_]+=\\S+\\s+)*chmod\\s+777\\b',
      '(?:>|tee\\s+)\\s*/(?:etc|usr|System|Library)/',
    ]).map((x) => compile(x, 'm')).filter(Boolean)
    const inString = (cmd, idx) => {
      let q = 0
      for (let i = 0; i < idx; i += 1) {
        const ch = cmd[i]
        if (ch === '\\' && cmd[i + 1] === '"') { i += 1; continue }
        if (ch === '"' || ch === "'") q += 1
      }
      return q % 2 === 1
    }
    const matched = (cmd) => res.some((re) => {
      const m = re.exec(cmd)
      return Boolean(m) && !inString(cmd, m.index)
    })
    const pool = facts.commands.filter((c) => matched(String(c.cmd || '')))
    const bad = pool.filter((c) => c.approval !== 'asked' && c.approval !== 'allowed')
    const samples = bad.slice(0, 5).map((c) => ({ at: when(c.startedAt), atMs: c.startedAt, session: c.session, cmd: String(c.cmd).slice(0, 80), extra: c.approval ? `审批=${c.approval}` : '无审批记录' }))
    const r = result(bad.length, pool.length, samples)
    r.detail = `敏感命令 ${pool.length} 条，其中 ${bad.length} 条没有 DSH 审批记录`
    return r
  },

  /** 正则命中 + 可选边界/审批要求 */
  regex(facts, b) {
    const sources = Array.isArray(b.sources) ? b.sources : [b.source || 'commands']
    if (sources.length > 1) {
      const results = sources.map((src) => PREDICATES.regex(facts, { ...b, sources: [src], source: src, target: src === 'fileWrites' ? 'content' : undefined }))
      const violation = results.find((r) => r.status === 'violation')
      if (violation) return violation
      if (results.every((r) => r.status === 'pass')) return { status: 'pass', detail: results.map((r) => r.detail).join('；'), samples: [] }
      return { status: 'unknown', detail: results.map((r) => r.detail).join('；'), samples: [] }
    }
    const source = b.source === 'fileWrites' ? facts.fileWrites.filter((w) => !(b.excludeDelegated && w.delegated)) : facts.commands
    const writeOnly = b.requireWrite ? source.filter((r) => /(^|\s)(?:>|>>|tee)\s/.test(String(r.cmd || ''))) : source
    const re = compile(b.pattern) || new RegExp('(?!x)x')
    const strip = (text) => {
      if (!b.skeleton) return text
      let out = []
      let end = null
      for (const line of String(text).split('\n')) {
        if (end) { if (line.trim() === end) end = null; continue }
        const m = /<<-?\s*['"]?([A-Za-z_]\w*)['"]?/.exec(line)
        if (m) { end = m[1]; out.push(line.replace(/<<-?.*$/, '')); continue }
        out.push(line)
      }
      return out.join('\n').replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, ' ')
    }
    const hits = writeOnly.filter((r) => {
      const text = b.target === 'content' ? r.content : b.target === 'path' ? r.path : r.cmd
      if (b.excludeLocalUrl && /https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\])/i.test(String(text)) && !/https?:\/\/(?!127\.0\.0\.1|localhost|\[::1\])/i.test(String(text))) return false
      return re.test(strip(text))
    })
    if (hits.length === 0) return { status: 'pass', hits: 0, base: source.length, rate: 0, detail: `扫描 ${source.length} 条，0 命中`, samples: [] }
    const samples = []
    let exempted = 0
    for (const h of hits) {
      if (b.boundary === 'outside-cwd') {
        const { inside, outside } = insideCount(h)
        if (inside && !outside) continue // 工作区内删除/写入不要求审批
        if (!outside) continue
        const outsideTargets = (h.targets || []).filter((t) => isInside(h.cwd, t) === false)
        if (outsideTargets.length > 0 && outsideTargets.every((t) => isTempPath(t, b))) { exempted += 1; continue }
      }
      if (b.requireUserPermit && h.user && new RegExp(b.requireUserPermit).test(h.user)) continue
      if (b.requireApproval) {
        if (h.approval && /^allowed/.test(h.approval)) continue
        if (h.approval && /denied/.test(h.approval)) continue
        if (h.isError) continue // 被沙箱拒/命令失败，未实际执行
      }
      samples.push({ ...h, atMs: h.startedAt, at: when(h.startedAt) })
    }
    const r = result(samples.length, hits.length, samples)
    if (exempted > 0) r.detail += `；其中 ${exempted} 条在临时区已豁免`
    return r
  },

  /** 目标是否越出会话工作区 */
  'path-boundary'(facts, b) {
    return PREDICATES.regex(facts, { ...b, source: 'commands', boundary: 'outside-cwd' })
  },

  /** 文件必须有指定标签/字段 */
  'field-presence'(facts, b) {
    let legacy = 0
    const win = Number(facts.windowStart || 0)
    const files = facts.fileWrites.filter((w) => {
      const exts = Array.isArray(b.exts) ? b.exts : (b.ext ? [b.ext] : [])
      if (exts.length && !exts.some((e) => w.path.endsWith(e))) return false
      if (b.pathPattern && !compile(b.pathPattern)?.test(w.path)) return false
      if (b.excludePath && compile(b.excludePath)?.test(w.path)) return false
      if (win && w.mtimeMs && w.mtimeMs < win) { legacy += 1; return false }
      return true
    })
    const seen = new Map()
    for (const f of files) if (!seen.has(f.path)) seen.set(f.path, f)
    if (seen.size === 0) return { status: 'unknown', hits: 0, base: 0, rate: null, detail: `窗口内无对象（窗口外 ${legacy} 个不计）`, samples: [] }
    const missing = []
    for (const [p, f] of seen) {
      const lacks = (b.fields || []).filter((field) => !new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?(?:\\*\\*)?${field}(?:\\*\\*)?\\s*[:：]`, 'm').test(f.content))
      if (lacks.length) missing.push({ path: p, lacks, atMs: f.mtimeMs, at: when(f.mtimeMs) })
    }
    const r = result(missing.length, seen.size, missing)
    if (legacy) r.detail += `（窗口外 ${legacy} 个不计）`
    return r
  },

  /** A 类调用是否早于 B 类（如先检索再查本地） */
  'sequence-order'(facts, b) {
    const tasks = facts.turns.filter((t) => !t.delegated && t.user && compile(b.taskPattern || '.') || new RegExp('(?!x)x').test(t.user.slice(0, 400)))
    let total = 0
    const bad = []
    for (const t of tasks) {
      const firstAt = Math.min(...t.calls.filter((c) => (b.then || []).includes(c.name)).map((c) => c.seq))
      if (!Number.isFinite(firstAt)) continue
      total += 1
      const webAt = Math.min(...t.calls.filter((c) => (b.first || ['web_search', 'web_fetch']).includes(c.name)).map((c) => c.seq))
      if (!(webAt < firstAt)) bad.push({ at: when(t.startTime), session: t.session, seq: t.seq, user: userLine(t), atMs: t.startTime })
    }
    if (total === 0) return { status: 'unknown', hits: 0, base: 0, rate: null, detail: '无样本', samples: [] }
    if (total < Number(b.minSamples || 1)) return { status: 'unknown', hits: bad.length, base: total, rate: null, detail: `样本不足（${total}/${b.minSamples}）`, samples: bad }
    return result(bad.length, total, bad)
  },

  /** 同命令连续失败后重试 */
  'count-threshold'(facts, b) {
    const limit = Number(b.consecutiveFailures || 2)
    const streak = new Map()
    let total = 0
    const bad = []
    for (const c of facts.commands) {
      const key = norm(c.cmd)
      total += 1
      if (!c.isError) { streak.delete(key); continue }
      const n = (streak.get(key) || 0) + 1
      streak.set(key, n)
      if (n > limit) bad.push({ seq: c.seq, session: c.session, cmd: key.slice(0, 80) })
    }
    if (total < Number(b.minSamples || 1)) return { status: 'unknown', hits: 0, base: total, rate: null, detail: `样本不足（${total}）`, samples: [] }
    return result(bad.length, total, bad)
  },

  /** 做了 X 就必须有 Y（如高风险交付要有独立复核） */
  requires(facts, b) {
    const files = facts.fileWrites.filter((w) => {
      if (w.delegated) return false
      const byPath = b.ifPathPattern ? new RegExp(b.ifPathPattern).test(w.path) : false
      const byContent = b.ifContentPattern ? new RegExp(b.ifContentPattern).test(w.content) : false
      if (b.ifPathPattern || b.ifContentPattern) return byPath || byContent
      return new RegExp(b.ifPattern || '.').test(w.path) || new RegExp(b.ifPattern || '.').test(w.content)
    })
    if (files.length === 0) return { status: 'unknown', hits: 0, base: 0, rate: null, detail: '无样本', samples: [] }
    const bad = []
    for (const f of files) {
      const key = `${f.session}#${f.turn}`
      if (!facts.subagentTurns.has(key)) bad.push({ path: f.path, session: f.session })
    }
    return result(bad.length, files.length, bad)
  },
}

/**
 * 长任务轮次必须出现某类收尾动作（turn-condition）。
 * 注意：这里只认可观测动作（归档/查上下文/lint），第四步「跑收尾命令」口径模糊不计。
 */
PREDICATES['turn-condition'] = function (facts, b) {
  const minCalls = Number(b.ifTurnCallMin || 0)
  const minSec = Number(b.ifTurnDurationSec || 0)
  const grace = Number(b.graceSec || 0)
  const matches = (t) => {
    const re = b.thenPattern ? new RegExp(b.thenPattern) : null
    const fre = b.thenFilePattern ? new RegExp(b.thenFilePattern) : null
    if (re && (t.calls || []).some((c) => re.test(`${c.name} ${String(c.args?.command || '')} ${String(c.args?.file_path || '')}`))) return true
    if (fre && (t.writes || []).some((w) => fre.test(w.path))) return true
    return false
  }
  const long = facts.turns.filter((t) => {
    if (t.delegated) return false
    const calls = (t.calls || []).length
    const sec = t.startTime && t.endTime ? (t.endTime - t.startTime) / 1000 : 0
    return (minCalls && calls >= minCalls) || (minSec && sec >= minSec)
  })
  if (long.length === 0) return { status: 'unknown', hits: 0, base: 0, rate: null, detail: '无长任务样本', samples: [] }
  const graceOk = (t) => {
    if (!grace) return false
    const from = (t.startTime || 0) - grace * 1000
    return facts.turns.some((o) => o !== t && matches(o) && (o.startTime || 0) >= from && (o.startTime || 0) <= (t.startTime || 0))
  }
  const bad = long.filter((t) => !matches(t) && !graceOk(t))
  const samples = bad.slice(0, 5).map((t) => ({ at: when(t.startTime), session: t.session, seq: t.seq, user: userLine(t), calls: (t.calls || []).length, atMs: t.startTime }))
  const r = result(bad.length, long.length, samples)
  r.detail = `长任务 ${long.length} 轮，${bad.length} 轮缺少收尾动作`
  if (grace) r.detail += `（前 ${grace}s 内已收尾视为覆盖）`
  return r
}

/** WAL：收到用户指令后，必须在窗口内落盘（OpenClaw m5 迁移版）。 */
PREDICATES.wal = function (facts, b) {
  const within = Number(b.withinSec || 600) * 1000
  const fre = new RegExp(b.thenFilePattern || '.')
  const userRe = b.whenUserPattern ? new RegExp(b.whenUserPattern) : null
  const turns = facts.turns.filter((t) => String(t.user || '').trim() && !t.delegated && (!userRe || userRe.test(t.user)))
  if (turns.length === 0) return { status: 'unknown', hits: 0, base: 0, rate: null, detail: '无带指令的轮次', samples: [] }
  const bad = turns.filter((t) => !(t.writes || []).some((w) => fre.test(w.path) && (w.mtimeMs || 0) - (t.startTime || 0) <= within))
  const samples = bad.slice(0, 5).map((t) => ({ at: when(t.startTime), session: t.session, seq: t.seq, user: userLine(t), atMs: t.startTime }))
  const r = result(bad.length, turns.length, samples)
  r.detail = `${turns.length} 个带指令轮次里，${bad.length} 轮在 ${Math.round(within / 1000)}s 内没有落盘`
  return r
}

/** 单次调用阻塞超阈值且未后台化（duration）。 */
PREDICATES.duration = function (facts, b) {
  const limit = Number(b.minMinutes || 10) * 60000
  const measured = facts.commands.filter((c) => c.endAt > c.startedAt && (c.endAt - c.startedAt) < 4 * 3600 * 1000)
  if (measured.length === 0) return { status: 'unknown', hits: 0, base: 0, rate: null, detail: '无耗时样本', samples: [] }
  const bad = measured.filter((c) => (c.endAt - c.startedAt) >= limit && !c.backgrounded)
  const longest = Math.max(...measured.map((c) => c.endAt - c.startedAt))
  const r = result(bad.length, measured.length, bad)
  r.detail += `；最长 ${Math.round(longest / 1000)}s`
  return r
}

/** 平台指标阈值（metric）。 */
PREDICATES.metric = function (facts, b) {
  const v = facts.metrics?.[b.key]
  if (v === undefined || v === null) return { status: 'unknown', hits: 0, base: 0, rate: null, detail: `指标 ${b.key} 不可得`, samples: [] }
  const ok = b.op === '<=' ? v <= Number(b.threshold) : v >= Number(b.threshold)
  return { status: ok ? 'pass' : 'violation', hits: ok ? 0 : 1, base: 1, rate: ok ? 0 : 1, detail: `${b.key}=${(v * 100).toFixed(1)}%（阈值 ${b.op} ${b.threshold * 100}%）`, samples: [] }
}

const NEED = {
  'path-boundary': ['pattern'],
  'field-presence': ['fields'],
  'count-threshold': ['consecutiveFailures'],
  'turn-condition': [],
  'sequence-order': ['taskPattern', 'first', 'then'],
  duration: ['minMinutes'],
  metric: ['key', 'threshold'],
  regex: ['pattern'],
  never: ['pattern'],
  'per-turn-cap': ['toolPattern', 'maxPerTurn'],
  'change-gate': ['sections'],
}

export function runPredicate(facts, bind) {
  const need = NEED[bind?.type] || []
  const missing = need.filter((k) => {
    const v = bind[k]
    if (Array.isArray(v)) return v.length === 0
    return v === undefined || v === null || v === ''
  })
  if (missing.length) {
    return { status: 'unknown', hits: 0, base: 0, rate: null, detail: `判据参数缺失：${missing.join('、')}（${bind?.type}），不予判定`, samples: [] }
  }

  const fn = bind && PREDICATES[bind.type]
  if (!fn) return { status: 'unknown', detail: `未实现谓词：${bind?.type || '(无)'}`, samples: [] }
  try { return fn(facts, bind) } catch (e) { return { status: 'unknown', detail: `谓词执行失败：${e.message}`, samples: [] } }
}
