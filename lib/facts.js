/**
 * 平台事实流：只读 DSH 会话日志，产出与「规则」无关的客观事实。
 * 任何规则都只从这里取数，collector 不绑规则。
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const HOME = process.env.HOME || ''
const SESSIONS_DIR = path.join(HOME, '.dsh', 'sessions')
const MAX_SESSIONS = 400
const MAX_BYTES = 64 * 1024 * 1024

export function isInside(cwd, p) {
  if (!cwd || !p) return null
  const n = path.normalize(p)
  return n === cwd || n.startsWith(cwd + path.sep)
}

function expand(tok, vars) {
  let out = String(tok).replace(/^['"]|['"]$/g, '')
  out = out.replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g, (all, a, b) => vars.get(a || b) ?? all)
  if (out.startsWith('~/')) out = HOME + out.slice(1)
  return out
}

function assignments(cmd) {
  const vars = new Map()
  const re = /(?:^|[;&|(\n]\s*)([A-Za-z_]\w*)=("[^"]*"|'[^']*'|\S+)/g
  let m
  while ((m = re.exec(cmd)) !== null) vars.set(m[1], m[2].replace(/^['"]|['"]$/g, ''))
  return vars
}

/** 只取 rm 段的目标路径（不看其他命令的参数，避免把 cp/find 的路径算进来）。 */
function rmTargets(cmd) {
  const vars = assignments(cmd)
  const out = []
  const re = /(?:^|[;&|(\n]|\s)rm\s+([^;&|\n]+)/g
  let m
  while ((m = re.exec(cmd)) !== null) {
    for (const tok of m[1].split(/\s+/)) {
      if (!tok || tok.startsWith('-')) continue
      const p = expand(tok, vars)
      if (p.startsWith('/')) out.push(p)
    }
  }
  return out
}

/** 上下文占用：取投影缓存里最近一条请求的比例。 */
function contextRatio() {
  const dir = path.join(HOME, '.dsh', 'storages', 'session_projcache', 'sessions')
  let files = []
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')) } catch { return null }
  let best = null
  for (const f of files) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
      const t = d.record?.rows?.contextTimeline?.val
      const reqs = t?.requests || []
      const last = reqs[reqs.length - 1]
      if (!last || !t?.contextWindow) continue
      const r = Number(last.total || 0) / Number(t.contextWindow || 1)
      if (best === null || r > best) best = r
    } catch { /* 跳过坏文件 */ }
  }
  return best
}

export function buildFacts(windowHours = 720) {
  const cutoff = Date.now() - windowHours * 3600 * 1000
  const facts = { sessions: 0, turns: [], commands: [], fileWrites: [], subagentTurns: new Set(), jobCalls: new Set(), jobs: 0, metrics: {}, unavailable: [] }
  let dirs = []
  try { dirs = fs.readdirSync(SESSIONS_DIR) } catch { facts.unavailable.push('sessions_dir_unreadable'); return facts }
  let scanned = 0
  for (const d of dirs) {
    const dp = path.join(SESSIONS_DIR, d)
    let subs = []
    try { if (!fs.statSync(dp).isDirectory()) continue; subs = fs.readdirSync(dp) } catch { continue }
    for (const s of subs) {
      const fp = path.join(dp, s, 'session.v4.jsonl.zstd')
      let st
      try { st = fs.statSync(fp) } catch { continue }
      if (st.mtimeMs < cutoff) continue
      if (scanned >= MAX_SESSIONS) break
      scanned += 1
      let rows
      try {
        const buf = zlib.zstdDecompressSync(fs.readFileSync(fp))
        if (buf.length > MAX_BYTES) continue
        rows = buf.toString('utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
      } catch { facts.unavailable.push(`session:${String(s).slice(0, 8)}`); continue }
      facts.sessions += 1
      const delegated = rows.some((r) => r.type === 'sandbox/mode' && r.data?.source === 'delegation')
      let cwd = ''
      for (const r of rows) { const c = r.data?.meta?.cwd; if (typeof c === 'string' && c.startsWith('/')) { cwd = c; break } }
      const approvals = new Map()
      const results = new Map()
      for (const r of rows) {
        if (r.type === 'approval/asked' && r.data?.callId) approvals.set(r.data.callId, 'asked')
        else if (r.type === 'approval/decided' && r.data?.id) approvals.set(r.data.id, r.data?.outcome || 'decided')
        else if (r.type === 'tool/result') {
          const id = r.data?.message?.toolCallId || r.data?.toolCallId
          if (id) results.set(id, { isError: Boolean(r.data?.isError), at: r.time })
        } else if (r.type === 'job/registered') {
          facts.jobs += 1
          const id = r.data?.toolCall?.callId
          if (id) facts.jobCalls.add(id)
        }
      }
      let turn = null
      let lastUser = ''
      const flush = () => { if (turn) facts.turns.push(turn); turn = null }
      for (const r of rows) {
        if (r.type === 'turn/start') { flush(); turn = { session: String(s).slice(0, 8), seq: r.seq, cwd, delegated, calls: [], user: lastUser, reviewed: false, startTime: r.time } ; continue }
        if (!turn) continue
        if (r.type === 'user/message') {
          const t = (r.data?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(' ')
          if (t && !t.startsWith('<system-reminder>')) { lastUser = t; turn.user = (turn.user ? turn.user + ' ' : '') + t }
        } else if (r.type === 'tool/call') {
          const name = r.data?.name
          let args = {}
          try { args = JSON.parse(r.data.arguments || '{}') } catch { /* 非 JSON */ }
          turn.calls.push({ name, seq: r.seq, callId: r.data?.callId, args })
          if (name === 'subagent' || name === 'subagent_fork') { turn.reviewed = true; facts.subagentTurns.add(`${turn.session}#${turn.seq}`) }
          if (name === 'bash') {
            const cmd = String(args.command || '')
            const verdict = approvals.get(r.data?.callId)
            const res = results.get(r.data?.callId)
            facts.commands.push({
              session: turn.session, turn: turn.seq, seq: r.seq, cwd, delegated,
              cmd, user: turn.user, isError: Boolean(res?.isError), approval: verdict || null,
              targets: rmTargets(cmd), startedAt: r.time, endAt: res?.at || 0,
              backgrounded: facts.jobCalls.has(r.data?.callId),
            })
          } else if (name === 'write' || name === 'edit') {
            if (args.file_path) {
              const fp2 = String(args.file_path)
              let mtimeMs = 0
              try { mtimeMs = fs.statSync(fp2).mtimeMs } catch { /* 文件已不存在 */ }
              facts.fileWrites.push({ session: turn.session, turn: turn.seq, seq: r.seq, path: fp2, content: String(args.content || ''), mtimeMs, delegated })
            }
          }
        }
      }
      flush()
    }
  }
  facts.metrics.context_ratio = contextRatio()
  return facts
}
