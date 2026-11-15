/**
 * ruleset_init：把 AGENTS.md 抽取成 draft policy，写到 <workspace>/.ruleset/policy.draft.yaml。
 * 边界：只在用户显式要求时执行；永不写正式 policy.yaml；已存在则需 overwrite。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { extractFromAgents } from './extract.js'

const require = createRequire(import.meta.url)
let yaml = null
try { yaml = require('js-yaml') } catch { /* 退化 JSON */ }

export function initDraft({ workspace, agentsFile, out, overwrite = false } = {}) {
  const ws = workspace || path.join(process.env.HOME || '', '.dsh', 'workspace')
  const outDir = out ? path.dirname(out) : path.join(ws, '.ruleset')
  const outFile = out || path.join(outDir, 'policy.draft.yaml')
  if (fs.existsSync(outFile) && !overwrite) {
    return { ok: false, reason: 'exists', file: outFile }
  }
  const agents = agentsFile || path.join(ws, 'AGENTS.md')
  if (!fs.existsSync(agents)) return { ok: false, reason: 'no-agents', file: agents }
  const text = fs.readFileSync(agents, 'utf8')
  const res = extractFromAgents(text, path.basename(agents))
  const policy = { version: 1, meta: { draft: true, source: agents, extractedAt: new Date().toISOString() }, rules: res.rules }
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(outFile, yaml?.dump ? yaml.dump(policy, { noRefs: true, lineWidth: 200 }) : JSON.stringify(policy, null, 2))
  return { ok: true, file: outFile, total: res.total, byClass: res.byClass }
}
