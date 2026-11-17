#!/usr/bin/env node
/**
 * 把带 bind 的 policy（如 examples/policy.full.yaml）里的 observe.bind
 * 合并进目标 policy，只补 bind，不改其他字段。
 *
 * 用法：node scripts/merge-binds.mjs <target-policy> <binds-source> [--write]
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import { validatePolicy } from '../lib/validate.js'

const require = createRequire(import.meta.url)
const yaml = require('js-yaml')

const [, , target, source, flag] = process.argv
if (!target || !source) {
  console.error('用法: node scripts/merge-binds.mjs <target-policy> <binds-source> [--write]')
  process.exit(2)
}
const write = flag === '--write'

const dst = yaml.load(fs.readFileSync(target, 'utf8'))
const src = yaml.load(fs.readFileSync(source, 'utf8'))
const bindById = new Map(
  (src.rules || []).filter((r) => r?.observe?.bind).map((r) => [r.id, r.observe.bind]),
)

const added = []
const skippedHas = []
const missing = []
for (const r of dst.rules || []) {
  const bind = bindById.get(r.id)
  if (!bind) { missing.push(r.id); continue }
  if (r.observe?.bind) { skippedHas.push(r.id); continue }
  r.observe = { ...(r.observe || {}), bind }
  added.push(r.id)
}

console.log(`目标：${target}`)
console.log(`将新增 bind：${added.length} 条`)
for (const id of added) console.log('  +', id)
if (skippedHas.length) console.log(`已有 bind（跳过）：${skippedHas.join(', ')}`)
if (missing.length) console.log(`源里没有对应 bind：${missing.join(', ')}`)

const v = validatePolicy(dst)
console.log(`校验：${v.ok ? '通过' : '失败 ' + v.errors.slice(0, 3).join('; ')}`)

if (!write) { console.log('(dry-run；加 --write 落盘)'); process.exit(0) }
if (!v.ok) { console.error('校验不通过，拒绝落盘'); process.exit(1) }

const backup = `${target}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`
fs.copyFileSync(target, backup)
fs.writeFileSync(target, yaml.dump(dst, { noRefs: true, lineWidth: 200 }))
console.log(`已写入；备份：${backup}`)
