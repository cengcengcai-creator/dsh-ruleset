/**
 * 六类谓词执行器：规则在 policy 里声明用哪个谓词，这里统一执行。
 * 判据不写在代码里；新增规则 = 改 policy。
 */
import { isInside } from './facts.js'

const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ')

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

export const PREDICATES = {
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
    const re = new RegExp(b.pattern)
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
    for (const h of hits) {
      if (b.boundary === 'outside-cwd') {
        const { inside, outside } = insideCount(h)
        if (inside && !outside) continue // 工作区内删除/写入不要求审批
        if (!outside) continue
      }
      if (b.requireUserPermit && h.user && new RegExp(b.requireUserPermit).test(h.user)) continue
      if (b.requireApproval) {
        if (h.approval && /^allowed/.test(h.approval)) continue
        if (h.approval && /denied/.test(h.approval)) continue
        if (h.isError) continue // 被沙箱拒/命令失败，未实际执行
      }
      samples.push(h)
    }
    return result(samples.length, hits.length, samples)
  },

  /** 目标是否越出会话工作区 */
  'path-boundary'(facts, b) {
    return PREDICATES.regex(facts, { ...b, source: 'commands', boundary: 'outside-cwd' })
  },

  /** 文件必须有指定标签/字段 */
  'field-presence'(facts, b) {
    const legacyMs = Number(b.legacyDays || 7) * 86400 * 1000
    let legacy = 0
    const files = facts.fileWrites.filter((w) => {
      if (b.ext && !w.path.endsWith(b.ext)) return false
      if (b.pathPattern && !new RegExp(b.pathPattern).test(w.path)) return false
      if (b.excludePath && new RegExp(b.excludePath).test(w.path)) return false
      if (w.mtimeMs > 0 && w.mtimeMs < Date.now() - legacyMs) { legacy += 1; return false }
      return true
    })
    const seen = new Map()
    for (const f of files) if (!seen.has(f.path)) seen.set(f.path, f)
    if (seen.size === 0) return { status: 'unknown', hits: 0, base: 0, rate: null, detail: `无样本（另有 legacy ${legacy} 个不计）`, samples: [] }
    const missing = []
    for (const [p, f] of seen) {
      const lacks = (b.fields || []).filter((field) => !new RegExp(`(?:^|\\n)\\s*(?:[-*]\\s*)?(?:\\*\\*)?${field}(?:\\*\\*)?\\s*[:：]`, 'm').test(f.content))
      if (lacks.length) missing.push({ path: p, lacks })
    }
    const r = result(missing.length, seen.size, missing)
    r.detail += `（另有 legacy ${legacy} 个不计）`
    return r
  },

  /** A 类调用是否早于 B 类（如先检索再查本地） */
  'sequence-order'(facts, b) {
    const tasks = facts.turns.filter((t) => !t.delegated && t.user && new RegExp(b.taskPattern || '.').test(t.user.slice(0, 400)))
    let total = 0
    const bad = []
    for (const t of tasks) {
      const firstAt = Math.min(...t.calls.filter((c) => (b.then || []).includes(c.name) || (c.name === 'bash' && new RegExp(b.localBash || 'grep|cat|tail|lsof').test(String(c.args.command || '')))).map((c) => c.seq))
      if (!Number.isFinite(firstAt)) continue
      total += 1
      const webAt = Math.min(...t.calls.filter((c) => (b.first || ['web_search', 'web_fetch']).includes(c.name)).map((c) => c.seq))
      if (!(webAt < firstAt)) bad.push({ session: t.session, seq: t.seq })
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
  const minCalls = Number(b.ifTurnCallMin || 12)
  const long = facts.turns.filter((t) => !t.delegated && t.calls.length >= minCalls)
  if (long.length === 0) return { status: 'unknown', hits: 0, base: 0, rate: null, detail: '无长任务样本', samples: [] }
  const bad = []
  for (const t of long) {
    const hit = t.calls.some((c) => {
      const text = `${c.name} ${String(c.args.command || '')} ${String(c.args.file_path || '')}`
      return new RegExp(b.thenPattern).test(text)
    })
    if (!hit) bad.push({ session: t.session, seq: t.seq, calls: t.calls.length })
  }
  return result(bad.length, long.length, bad)
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

export function runPredicate(facts, bind) {
  const fn = bind && PREDICATES[bind.type]
  if (!fn) return { status: 'unknown', detail: `未实现谓词：${bind?.type || '(无)'}`, samples: [] }
  try { return fn(facts, bind) } catch (e) { return { status: 'unknown', detail: `谓词执行失败：${e.message}`, samples: [] } }
}
