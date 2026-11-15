import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dedupeRules } from '../lib/dedupe.js'

test('已出现在 AGENTS.md 的规则被跳过注入', () => {
  const agents = '**不得**把凭据写进文件；必须包含 type: 首部'
  const rules = [
    { id: 'a', text: '不得把凭据写进文件' },
    { id: 'b', text: '这是一条全新规则，AGENTS 里没有' },
  ]
  const r = dedupeRules(rules, agents)
  assert.deepEqual(r.kept.map((x) => x.id), ['b'])
  assert.deepEqual(r.skipped.map((x) => x.id), ['a'])
})

test('没有 AGENTS 内容时全部保留', () => {
  const rules = [{ id: 'a', text: 'x' }]
  assert.equal(dedupeRules(rules, '').kept.length, 1)
})
