import test from 'node:test'
import assert from 'node:assert/strict'

test('插件可以加载并注册工具与路由（防止语法/重复导入导致整包失败）', async () => {
  const mod = await import('../lib/index.js')
  const entries = []
  const ctx = {
    effect: (fn) => fn(),
    inject: (deps, cb) => cb({
      get: () => ({ fetch: { register: (o) => { entries.push(o.path); return () => {} } } }),
      effect: (fn) => fn(),
    }),
    systemPrompt: { section: () => () => {} },
    tools: { register: (t) => { entries.push(`tool:${t.name}`); return () => {} } },
  }
  mod.apply(ctx, {})
  assert.ok(entries.includes('tool:ruleset_audit'), '缺少 ruleset_audit')
  assert.ok(entries.includes('tool:ruleset_parse'), '缺少 ruleset_parse')
  assert.ok(entries.includes('/api/dsh-ruleset/report'), '缺少 report 路由')
  assert.ok(entries.includes('/api/dsh-ruleset/judge'), '缺少 judge 路由')
})
