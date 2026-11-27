/** policy 读取（唯一真源）。解析失败返回 null → 调用方必须按 unknown 处理。 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { validatePolicy } from './validate.js'

const require = createRequire(import.meta.url)
let yaml = null
try { yaml = require('js-yaml') } catch { yaml = null }

let lastError = null

/** 最近一次加载失败的原因（供面板与自检日志使用）。 */
export function lastLoadError() {
  return lastError
}

function logFailure(file, message) {
  lastError = { file, message, at: new Date().toISOString() }
  try {
    const dir = path.join(process.env.HOME || '', '.dsh', 'workspace', '.ruleset')
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, 'load-error.log'), `${lastError.at}\t${file}\t${message}\n`)
  } catch { /* ignore */ }
}

function markSuccess() { lastError = null }

const candidates = (explicit) => [
  explicit,
  process.env.DSH_RULESET_POLICY || '',
  path.join(process.env.HOME || '', '.dsh', 'workspace', 'policy.yaml'),
].filter(Boolean)

export function loadPolicy(explicit) {
  // 显式给了路径就不再回落：读不到/解析失败必须返回 null（unknown），
  // 否则会静默用别人的 policy 顶上，判出完全不相干的结论。
  if (explicit) {
    try {
      if (!fs.existsSync(explicit)) return null
      const raw = fs.readFileSync(explicit, 'utf8')
      const parsed = yaml?.load ? yaml.load(raw) : JSON.parse(raw)
      const v = validatePolicy(parsed)
      if (!v.ok) { logFailure(explicit, v.errors.join('; ')); return null }
      markSuccess()
      return parsed
    } catch (e) { logFailure(explicit, e?.message || String(e)); return null }
  }
  for (const p of candidates(explicit)) {
    try {
      if (!fs.existsSync(p)) continue
      const raw = fs.readFileSync(p, 'utf8')
      const parsed = yaml?.load ? yaml.load(raw) : JSON.parse(raw)
      const v = validatePolicy(parsed)
      if (!v.ok) { logFailure(p, v.errors.slice(0, 5).join('; ')); continue }
      markSuccess()
      return parsed
    } catch (e) { logFailure(p, e?.message || String(e)); /* next */ }
  }
  return null
}

/** mtime 缓存：改 policy 不需要重启。读取失败回退到上次成功值。 */
export function watchPolicy(explicit) {
  let cache = null
  let stamp = -1
  return {
    get() {
      const p = candidates(explicit).find((f) => { try { return fs.existsSync(f) } catch { return false } })
      if (!p) return cache
      let mt = 0
      try { mt = fs.statSync(p).mtimeMs } catch { return cache }
      if (mt !== stamp) {
        const next = loadPolicy(p)
        if (next) { cache = next; stamp = mt }
      }
      return cache
    },
  }
}
