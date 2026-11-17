/**
 * 平台事实流：只读 DSH 会话日志，产出与「规则」无关的客观事实。
 * 任何规则都只从这里取数，collector 不绑规则。
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { spawnSync } from 'node:child_process'

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
function contextRatio(cutoffMs = 0) {
  const dir = path.join(HOME, '.dsh', 'storages', 'session_projcache', 'sessions')
  let files = []
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')) } catch { return null }
  let best = null
  for (const f of files) {
    try {
      const fp = path.join(dir, f)
      if (cutoffMs && fs.statSync(fp).mtimeMs < cutoffMs) continue
      const d = JSON.parse(fs.readFileSync(fp, 'utf8'))
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

const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/**
 * 解压 zstd 会话文件。
 * 会话日志是多帧追加写的（每个事件一帧）；某些运行时（Electron 自带的）只解第一帧，
 * 返回一行就结束，表现为“26 会话 / 0 轮”。所以先数帧，多于 1 帧就逐帧解。
 */
function decompressZstd(raw) {
  const offsets = []
  let idx = raw.indexOf(ZSTD_MAGIC)
  while (idx !== -1) { offsets.push(idx); idx = raw.indexOf(ZSTD_MAGIC, idx + 4) }

  if (offsets.length <= 1) {
    const out = zlib.zstdDecompressSync(raw)
    if (!out?.length) throw new Error('empty decode')
    return out
  }

  const parts = []
  for (let i = 0; i < offsets.length; i += 1) {
    let done = false
    for (let span = 1; span <= 3 && i + span <= offsets.length && !done; span += 1) {
      const end = i + span < offsets.length ? offsets[i + span] : raw.length
      try {
        const d = zlib.zstdDecompressSync(raw.subarray(offsets[i], end))
        if (d?.length) { parts.push(d); i += span - 1; done = true }
      } catch { /* 试更大的跨度 */ }
    }
    if (!done) throw new Error('frame decode failed')
  }
  if (parts.length === 0) throw new Error('no frame decoded')
  return Buffer.concat(parts)
}

function parseSession(file) {
  const st = fs.statSync(file)
  if (st.size > MAX_BYTES) throw new Error('too-large')
  let buf
  try { buf = decompressZstd(fs.readFileSync(file)) } catch { buf = decompressViaCli(file) }
  const rows = []
  for (const line of buf.toString('utf8').split('\n')) {
    if (!line) continue
    try { rows.push(JSON.parse(line)) } catch { /* 残行 */ }
  }
  return { rows, bytes: buf.length }
}

function when(ms) {
  if (!ms) return ''
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function buildFacts(windowHours = 720) {
  const cutoff = Date.now() - windowHours * 3600 * 1000
  const facts = { windowStart: cutoff, permissionChanges: [], jobs: [], jobsCount: 0, commandsRun: [], dir: SESSIONS_DIR, home: process.env.HOME || '', files: 0, sessions: 0, turns: [], commands: [], fileWrites: [], subagentTurns: new Set(), jobCalls: new Set(), metrics: {}, unavailable: [] }
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
        const parsed = parseSession(fp)
        rows = parsed.rows
        facts.bytes = (facts.bytes || 0) + parsed.bytes
        if (!facts.sample) {
          let rawSize = 0
          try { rawSize = fs.statSync(fp).size } catch { /* ignore */ }
          facts.sample = { file: path.basename(path.dirname(fp)).slice(0, 12), rawSize, decoded: parsed.bytes, rows: rows.length, zstd: typeof zlib.zstdDecompressSync }
        }
        if (rows.length === 0) { facts.unavailable.push(`empty:${String(s).slice(0, 8)}`); continue }
      } catch { facts.unavailable.push(`session:${String(s).slice(0, 8)}`); continue }
      facts.sessions += 1
      facts.files += 1
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
        }
      }
      let turn = null
      let lastUser = ''
      const flush = () => { if (turn) facts.turns.push(turn); turn = null }
      for (const r of rows) {
        if (r.type === 'turn/end' && turn) { turn.endTime = r.time; continue }
        if (r.type === 'turn/start') { flush(); turn = { session: String(s).slice(0, 8), seq: r.seq, cwd, delegated, calls: [], user: lastUser, reviewed: false, startTime: r.time } ; continue }
        if (!turn) continue
        if (r.type === 'permission/preset') {
          const to = r.data?.preset || ''
          if (to) {
            if (turn.lastPreset && turn.lastPreset !== to) {
              facts.permissionChanges.push({ session: turn.session, turn: turn.seq, at: when(r.time), atMs: r.time, from: turn.lastPreset, to, said: Boolean(turn.said) })
            }
            turn.lastPreset = to
          }
          continue
        }
        if (r.type === 'command/run') {
          facts.commandsRun.push({ session: turn.session, turn: turn.seq, at: when(r.time), atMs: r.time, name: r.data?.name || '', done: false })
          continue
        }
        if (r.type === 'command/done') {
          const lastC = facts.commandsRun[facts.commandsRun.length - 1]
          if (lastC && !lastC.done) { lastC.done = true; lastC.outcome = r.data?.result?.kind || '' }
          continue
        }
        if (r.type === 'job/registered') {
          const jid = r.data?.toolCall?.callId || ''
          facts.jobsCount += 1
          facts.jobs.push({ id: jid, at: when(r.time), atMs: r.time, session: turn.session, turn: turn.seq, settledAt: 0 })
          continue
        }
        if (r.type === 'job/settled') {
          const jid = r.data?.toolCall?.callId
          const j = facts.jobs.find((x) => x.id === jid && !x.settledAt)
          if (j) j.settledAt = r.time
          continue
        }
        if (r.type === 'user/message') {
          const t = (r.data?.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(' ')
          if (t && !t.startsWith('<system-reminder>')) { lastUser = t; turn.user = (turn.user ? turn.user + ' ' : '') + t }
        } else if (r.type === 'assistant/message') {
          if (!turn.calls.length) turn.saidBeforeCall = true
          turn.said = true
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
              turn.writes = turn.writes || []
              turn.writes.push({ path: fp2, mtimeMs })
            }
          }
        }
      }
      flush()
    }
  }
  for (const j of facts.jobs) if (j.settledAt && j.registeredAt) j.durationMs = j.settledAt - j.registeredAt
  facts.metrics.context_ratio = contextRatio(cutoff)
  return facts
}
