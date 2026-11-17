/**
 * 宿主命令通道：`/ruleset <json>` —— UI 在没有 HTTP 路由的环境（桌面端）下走这里。
 * 只做分发，实现在 service.js。
 */
import { createService } from './service.js'

export function registerCommands(ctx) {
  if (typeof ctx?.inject !== 'function') return () => {}
  let dispose = () => {}
  const sub = ctx.inject(['commands'], (scope) => {
    const commands = scope.get?.('commands')
    if (!commands?.register) return
    const svc = createService(ctx)
    const off = commands.register({
      definitionId: 'dsh-ruleset:dispatch',
      name: 'ruleset',
      description: 'ruleset 内部通道：/ruleset {"op":"report","args":{...}}',
      recordInput: false,
      input: { hint: '{"op":"report","args":{}}' },
      handler: async (invocation) => {
        const raw = String(invocation?.rawInput || '').trim()
        let req = null
        try { req = JSON.parse(raw) } catch { return { kind: 'error', text: 'invalid JSON: ' + raw.slice(0, 80) } }
        const op = String(req?.op || '')
        const fn = svc[op]
        if (typeof fn !== 'function') return { kind: 'error', text: 'unknown op: ' + op }
        try {
          const out = await fn(req.args || {})
          return { kind: 'success', text: JSON.stringify(out) }
        } catch (e) {
          return { kind: 'error', text: 'op failed: ' + (e?.message || String(e)) }
        }
      },
    })
    dispose = typeof off === 'function' ? off : () => {}
  })
  return () => { dispose(); sub?.() }
}
