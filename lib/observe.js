/** 观测层：注册 observe_report 工具。判定只给三值，证据指回 seq / 文件。 */
import { buildFacts } from './facts.js'
import { evaluate, render } from './report.js'
import { initDraft } from './init.js'
import fs from 'node:fs'
import path from 'node:path'

export function registerReportTool(ctx, cfg, source) {
  const initTool = ctx.tools.register({
    name: 'ruleset_init',
    description: '把一个 AGENTS.md 抽取成 draft policy，写到 <workspace>/.ruleset/policy.draft.yaml。只在用户明确要求初始化规则时调用；永不覆盖正式 policy.yaml。',
    parameters: {
      overwrite: { type: 'boolean', description: '已存在 draft 时是否覆盖' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['ok', 'detail'],
        properties: {
          ok: { type: 'boolean' },
          file: { type: 'string' },
          detail: { type: 'string' },
        },
      },
      render: (_a, v) => [{ type: 'text', text: v.detail }],
    },
    async execute(args) {
      const r = initDraft({ overwrite: Boolean(args?.overwrite) })
      if (!r.ok) {
        const map = { exists: `草稿已存在：${r.file}（要覆盖请传 overwrite: true）`, 'no-agents': `没有找到 ${r.file}` }
        return { ok: false, file: r.file, detail: map[r.reason] || '初始化失败' }
      }
      return { ok: true, file: r.file, detail: `已生成草稿：${r.file}（${r.total} 条候选 ${JSON.stringify(r.byClass)}）。删改后改名为 policy.yaml 才会参与判定。` }
    },
  })
  const reportTool = ctx.tools.register({
    name: 'observe_report',
    description: '规则合规观测：读 policy 与会话轨迹，输出三值（pass/violation/unknown）。unknown 表示无数据源或样本不足，不得读作 pass。',
    parameters: { window_hours: { type: 'integer', description: '观测窗口（小时），默认取配置' } },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['report', 'evaluated', 'unknown'],
        properties: { report: { type: 'string' }, evaluated: { type: 'integer' }, unknown: { type: 'integer' } },
      },
      render: (_a, v) => [{ type: 'text', text: String(v?.report ?? '') }],
    },
    async execute(args) {
      const hours = Number(args?.window_hours) > 0 ? Number(args.window_hours) : cfg.windowHours
      const policy = source.policy
      const facts = buildFacts(hours)
      const rows = evaluate(policy, facts)
      const unknown = rows.filter((r) => r.status === 'unknown').length
      // 给 UI / 外部工具留一个可读快照（插件自有状态目录，不碰用户文件）
      try {
        const dir = path.join(process.env.HOME || '', '.dsh', 'workspace', '.ruleset')
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({
          at: new Date().toISOString(),
          source: { kind: source.kind, file: source.file },
          facts: { sessions: facts.sessions, turns: facts.turns.length, commands: facts.commands.length, writes: facts.fileWrites.length },
          rows: rows.map((r) => ({ id: r.id, title: r.title, status: r.status, hits: r.hits, base: r.base, rate: r.rate })),
        }, null, 2))
      } catch { /* 快照失败不影响报告 */ }
      return { report: render(policy, facts, rows, source), evaluated: rows.length - unknown, unknown }
    },
  })
  return () => { initTool?.(); reportTool?.() }
}
