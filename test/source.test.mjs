import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveRuleSource } from '../lib/source.js'

test('显式 policy 路径不存在 → none，不回落', () => {
  const s = resolveRuleSource('/definitely/not/here.yaml')
  assert.equal(s.kind, 'none')
  assert.match(s.warnings[0], /不存在/)
})

test('无 policy、有 AGENTS.md → agents-draft', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rs-'))
  const agents = path.join(dir, 'AGENTS.md')
  fs.writeFileSync(agents, '必须包含 type: 字段\n不得删除工作区外的文件\n')
  const old = process.env.DSH_RULESET_AGENTS
  const oldHome = process.env.HOME
  process.env.DSH_RULESET_AGENTS = agents
  process.env.HOME = dir
  try {
    const s = resolveRuleSource('')
    assert.equal(s.kind, 'agents-draft')
    assert.ok(s.policy.rules.length >= 1)
    assert.equal(s.policy.meta.draft, true)
  } finally {
    if (old === undefined) delete process.env.DSH_RULESET_AGENTS; else process.env.DSH_RULESET_AGENTS = old
    if (oldHome === undefined) delete process.env.HOME; else process.env.HOME = oldHome
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
