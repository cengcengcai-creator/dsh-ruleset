/** policy 读取（唯一真源）。解析失败返回 null → 调用方必须按 unknown 处理。 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { validatePolicy } from './validate.js'

const require = createRequire(import.meta.url)
let yaml = null
try { yaml = require('js-yaml') } catch { yaml = null }

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
      if (!v.ok) throw new Error(`policy 校验失败: ${v.errors.join('; ')}`)
      return parsed
    } catch { return null }
  }
  for (const p of candidates(explicit)) {
    try {
      if (!fs.existsSync(p)) continue
      const raw = fs.readFileSync(p, 'utf8')
      return yaml?.load ? yaml.load(raw) : JSON.parse(raw)
    } catch { /* next */ }
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
