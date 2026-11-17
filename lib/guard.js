import fs from 'node:fs'
import path from 'node:path'

function logHit(pattern, cmd) {
  try {
    const dir = path.join(process.env.HOME || '', '.dsh', 'workspace', '.ruleset')
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, 'guard.log'), `${new Date().toISOString()}\t${pattern}\t${String(cmd).slice(0, 200)}\n`)
  } catch { /* 日志失败不影响拦截 */ }
}

/**
 * 执行前守卫：命中红线的 bash 调用直接返回 ask，让规则变成闸门而不是事后记录。
 * 契约来自 dsh-tools：`tools/pre-execute(exec, next) => PreToolDecision`。
 */
const DEFAULTS = [
  '(?:^|[;&|]\\s*)(?:[A-Za-z_]+=\\S+\\s+)*sudo\\b',
  '(?:^|[;&|]\\s*)(?:[A-Za-z_]+=\\S+\\s+)*chmod\\s+777\\b',
  '(?:^|[;&|]\\s*)(?:[A-Za-z_]+=\\S+\\s+)*osascript\\b',
  'curl\\b[^;|]*\\|\\s*(?:ba)?sh\\b',
  '(?:>|tee\\s+)\\s*/(?:etc|usr|System|Library)/',
  '\\blaunchctl\\s+(?:load|bootstrap)\\b[^;]*LaunchDaemons',
  'sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}',
]

function inString(cmd, idx) {
  let q = 0
  for (let i = 0; i < idx; i += 1) {
    const ch = cmd[i]
    if (ch === '\\' && cmd[i + 1] === '"') { i += 1; continue }
    if (ch === '"' || ch === "'") q += 1
  }
  return q % 2 === 1
}

const seenContexts = new WeakSet()

export function registerGuard(ctx, cfg = {}) {
  const enabled = cfg.guardEnabled !== false
  if (!enabled) return () => {}
  const patterns = (cfg.guardPatterns && cfg.guardPatterns.length ? cfg.guardPatterns : DEFAULTS)
    .map((p) => { try { return new RegExp(p, 'm') } catch { return null } })
    .filter(Boolean)
  if (!patterns.length) return () => {}

  const handler = async (exec, next) => {
    try {
      if (exec?.name !== 'bash') return next()
      const cmd = String(exec?.arguments?.command || exec?.args?.command || '')
      if (!cmd) return next()
      for (const re of patterns) {
        const m = re.exec(cmd)
        if (!m || inString(cmd, m.index)) continue
        logHit(m[0].slice(0, 40), cmd)
        return {
          kind: 'ask',
          reason: `ruleset 红线：命令命中受控模式 \`${m[0].slice(0, 40)}\`，需要你确认后才能执行`,
          displayReason: {
            en: 'ruleset red line: this command matches a guarded pattern and needs your confirmation.',
            zh: 'ruleset 红线：该命令命中受控模式，需要你确认后才能执行',
          },
        }
      }
    } catch { /* 守卫异常不阻断 */ }
    return next()
  }

  try {
    if (seenContexts.has(ctx)) return () => {}
    seenContexts.add(ctx)
    logHit('REGISTERED', `enabled=${enabled} patterns=${patterns.length}`)
    return ctx.on('tools/pre-execute', handler)
  } catch {
    return () => {}
  }
}
