/**
 * 宿主路由：给 UI 面板提供数据与操作入口。
 * 形状对齐 dsh-context：connection.fetch.register({path, methods:['POST'], requestBody, fetch})。
 * 只读 + 显式初始化；不写用户文件。
 */
import fs from 'node:fs'
import path from 'node:path'
import { initDraft } from './init.js'


const json = (value) => Response.json({ ok: true, value }, { headers: { 'cache-control': 'no-store' } })
const err = (code, message) => Response.json({ ok: false, error: { code, message } }, { headers: { 'cache-control': 'no-store' } })

function snapshotFile() {
  return path.join(process.env.HOME || '', '.dsh', 'workspace', '.ruleset', 'report.json')
}

export function registerRoutes(ctx, log) {
  if (typeof ctx?.inject !== 'function') return () => {}
  return ctx.inject(['connection'], (scope) => {
    try { log?.('info', 'connection 注入成功') } catch { /* ignore */ }
    const conn = scope.get?.('connection')
    if (!conn?.fetch?.register) return () => {}
    // 与 dsh-context 同形：注册放进 effect，随插件 dispose
    const reg = (p, handler, label) => {
      let dispose
      scope.effect(() => {
        dispose = conn.fetch.register({ path: p, methods: ['POST'], requestBody: 'buffered', fetch: handler, label })
      }, label)
      return () => dispose?.()
    }

    const d1 = reg('/api/dsh-ruleset/report', async () => {
      try {
        const raw = fs.readFileSync(snapshotFile(), 'utf8')
        return json(JSON.parse(raw))
      } catch {
        return err('dsh-ruleset/no-report', '还没有报告：先调用 observe_report')
      }
    }, 'dsh-ruleset: report route')

    const d2 = reg('/api/dsh-ruleset/init', async (req) => {
      let body = {}
      try { body = await req.json() } catch { /* 允许空 body */ }
      const r = initDraft({ overwrite: Boolean(body?.overwrite) })
      return r.ok ? json(r) : err('dsh-ruleset/init-failed', r.reason)
    }, 'dsh-ruleset: init route')

    try { log?.('info', 'routes registered: /api/dsh-ruleset/report, /api/dsh-ruleset/init') } catch { /* ignore */ }
    return () => { d1?.(); d2?.() }
  })
}
