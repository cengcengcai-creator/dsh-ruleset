import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runPredicate } from '../lib/predicates.js'
import { buildFacts } from '../lib/facts.js'

const facts = {
  sessions: 1, turns: [{ session: 's', seq: 1, cwd: '/w', delegated: false, calls: [{ name: 'read', seq: 5 }], user: '修一下' }],
  commands: [
    { session: 's', turn: 1, seq: 2, cwd: '/w', cmd: 'rm -rf /outside/x', targets: ['/outside/x'], isError: false, approval: null, user: '都做' },
    { session: 's', turn: 1, seq: 3, cwd: '/w', cmd: 'rm -rf /w/tmp', targets: ['/w/tmp'], isError: false, approval: null, user: '清理' },
    { session: 's', turn: 1, seq: 4, cwd: '/w', cmd: 'echo hi', targets: [], isError: false, approval: null, user: '' },
  ],
  fileWrites: [
    { session: 's', turn: 1, seq: 6, path: '/w/notes/a.md', content: 'type: 调研', mtimeMs: Date.now() },
    { session: 's', turn: 1, seq: 7, path: '/w/notes/b.md', content: 'no header', mtimeMs: Date.now() },
  ],
  subagentTurns: new Set(), metrics: { context_ratio: 0.2 },
}

test('path-boundary：工作区内跳过，越界且无审批判违规', () => {
  const v = runPredicate(facts, { type: 'path-boundary', pattern: 'rm\\s+-rf' })
  assert.equal(v.status, 'violation')
  assert.equal(v.samples.length, 1)
})

test('requireUserPermit：用户同意过则不再计违规', () => {
  const v = runPredicate(facts, { type: 'path-boundary', pattern: 'rm\\s+-rf', requireUserPermit: '都做' })
  assert.equal(v.status, 'pass')
})

test('field-presence：缺字段文件被指出', () => {
  const v = runPredicate(facts, { type: 'field-presence', ext: '.md', fields: ['type'] })
  assert.equal(v.status, 'violation')
  assert.equal(v.samples[0].path, '/w/notes/b.md')
})

test('count-threshold：无连续失败即 pass', () => {
  const v = runPredicate(facts, { type: 'count-threshold', consecutiveFailures: 2, minSamples: 1 })
  assert.equal(v.status, 'pass')
})

test('metric：阈值内 pass', () => {
  const v = runPredicate(facts, { type: 'metric', key: 'context_ratio', op: '<=', threshold: 0.4 })
  assert.equal(v.status, 'pass')
})

test('未知谓词 → unknown', () => {
  assert.equal(runPredicate(facts, { type: 'nope' }).status, 'unknown')
})
