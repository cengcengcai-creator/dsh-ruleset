import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validatePolicy } from '../lib/validate.js'

test('合法 policy 通过', () => {
  const ok = { version: 1, rules: [{ id: 'a-1', kind: 'protocol', title: 't', text: 'x', observe: { metric: 'm', bind: { type: 'regex', pattern: 'rm\\s' } } }] }
  assert.equal(validatePolicy(ok).ok, true)
})

test('缺 version / rules 报错', () => {
  assert.equal(validatePolicy({}).ok, false)
  assert.equal(validatePolicy({ version: 1 }).ok, false)
})

test('id 非 kebab-case 报错', () => {
  const bad = { version: 1, rules: [{ id: 'Bad_ID', kind: 'protocol', title: 't', text: 'x' }] }
  assert.equal(validatePolicy(bad).ok, false)
})

test('id 重复报错', () => {
  const bad = { version: 1, rules: [{ id: 'a', kind: 'protocol', title: 't', text: 'x' }, { id: 'a', kind: 'protocol', title: 't', text: 'x' }] }
  assert.equal(validatePolicy(bad).ok, false)
})

test('未知谓词类型报错', () => {
  const bad = { version: 1, rules: [{ id: 'a', kind: 'protocol', title: 't', text: 'x', observe: { metric: 'm', bind: { type: 'nope' } } }] }
  assert.equal(validatePolicy(bad).ok, false)
})

test('坏正则报错', () => {
  const bad = { version: 1, rules: [{ id: 'a', kind: 'protocol', title: 't', text: 'x', observe: { metric: 'm', bind: { type: 'regex', pattern: '(' } } }] }
  assert.equal(validatePolicy(bad).ok, false)
})
