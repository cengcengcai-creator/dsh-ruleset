#!/usr/bin/env node
/** 用法：node scripts/extract.mjs <AGENTS.md> [out.yaml] */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { extractFromAgents } from '../lib/extract.js'

const require = createRequire(import.meta.url)
let yaml = null
try { yaml = require('js-yaml') } catch { /* 无 js-yaml 时退化为 JSON */ }

const [, , input, out] = process.argv
if (!input) {
  console.error('用法: node scripts/extract.mjs <AGENTS.md> [out.yaml]')
  process.exit(2)
}
const text = fs.readFileSync(input, 'utf8')
const res = extractFromAgents(text, input.split('/').pop())
const policy = { version: 1, meta: { draft: true, source: input, extractedAt: new Date().toISOString() }, rules: res.rules }
const serialized = yaml?.dump ? yaml.dump(policy, { noRefs: true, lineWidth: 200 }) : JSON.stringify(policy, null, 2)
if (out) fs.writeFileSync(out, serialized)
else process.stdout.write(serialized)
console.error(`# ${res.file}: ${res.total} 条候选 ${JSON.stringify(res.byClass)}`)
