/**
 * HTTP 适配层（薄）：路由只做请求解析与 JSON 包装，实现全部在 service.js。
 * 桌面端 dsh-app:// 下部分路径曾出现 404，客户端已支持回退到工具/命令通道。
 */
import { createService } from './service.js'

const json = (value) => Response.json(value, { headers: { 'cache-control': 'no-store' } })

export function registerRoutes(ctx, log) {
  if (typeof ctx?.inject !== 'function') return () => {}
  return ctx.inject(['connection'], (scope) => {
    try { log?.('info', 'connection 注入成功') } catch { /* ignore */ }
    const conn = scope.get?.('connection')
    if (!conn?.fetch?.register) return () => {}
    const svc = createService(ctx)
    const reg = (p, name, label) => {
      let dispose
      scope.effect(() => {
        dispose = conn.fetch.register({
          path: p,
          methods: ['POST'],
          requestBody: 'buffered',
          label,
          fetch: async (req) => {
            let body = {}
            try { body = await req.json() } catch { /* 允许空 body */ }
            try { return json(await svc[name](body)) } catch (e) {
              return json({ ok: false, error: { code: `dsh-ruleset/${name}-failed`, message: e?.message || String(e) } })
            }
          },
        })
      }, label)
      return () => dispose?.()
    }

    const disposers = [
      reg('/api/dsh-ruleset/report', 'report', 'dsh-ruleset: report'),
      reg('/api/dsh-ruleset/audit', 'audit', 'dsh-ruleset: audit'),
      reg('/api/dsh-ruleset/rules', 'rules', 'dsh-ruleset: rules'),
      reg('/api/dsh-ruleset/add-rule', 'addRule', 'dsh-ruleset: add-rule'),
      reg('/api/dsh-ruleset/remove-rule', 'removeRule', 'dsh-ruleset: remove-rule'),
      reg('/api/dsh-ruleset/update-rule', 'updateRule', 'dsh-ruleset: update-rule'),
      reg('/api/dsh-ruleset/set-tier', 'setTier', 'dsh-ruleset: set-tier'),
      reg('/api/dsh-ruleset/dedupe', 'dedupe', 'dsh-ruleset: dedupe'),
      reg('/api/dsh-ruleset/init', 'init', 'dsh-ruleset: init'),
      reg('/api/dsh-ruleset/predicates', 'predicates', 'dsh-ruleset: predicates'),
      reg('/api/dsh-ruleset/parse', 'parse', 'dsh-ruleset: parse'),
      reg('/api/dsh-ruleset/judge', 'judge', 'dsh-ruleset: judge'),
      reg('/api/dsh-ruleset/introspect', 'introspect', 'dsh-ruleset: introspect'),
      reg('/api/dsh-ruleset/suggest', 'suggest', 'dsh-ruleset: suggest'),
      reg('/api/dsh-ruleset/baseline', 'baseline', 'dsh-ruleset: baseline'),
      reg('/api/dsh-ruleset/finding-status', 'findingStatus', 'dsh-ruleset: finding-status'),
      reg('/api/dsh-ruleset/hygiene', 'hygiene', 'dsh-ruleset: hygiene'),
      reg('/api/dsh-ruleset/guard-log', 'guardLog', 'dsh-ruleset: guard-log'),
      reg('/api/dsh-ruleset/injected', 'injected', 'dsh-ruleset: injected'),
      reg('/api/dsh-ruleset/backups', 'backups', 'dsh-ruleset: backups'),
      reg('/api/dsh-ruleset/restore', 'restore', 'dsh-ruleset: restore'),
      reg('/api/dsh-ruleset/export', 'exportKeep', 'dsh-ruleset: export'),
    ]
    return () => disposers.forEach((d) => d?.())
  })
}
