/** 观测层：注册 observe_report 工具。判定只给三值，证据指回 seq / 文件。 */
import { buildFacts } from './facts.js'
import { evaluate, render } from './report.js'

export function registerReportTool(ctx, cfg, source) {
  return ctx.tools.register({
    name: 'observe_report',
    description: '规则合规观测：读 policy 与会话轨迹，输出三值（pass/violation/unknown）。unknown 表示无数据源或样本不足，不得读作 pass。',
    parameters: { window_hours: { type: 'integer', description: '观测窗口（小时），默认取配置' } },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { report: { type: 'string', required: true }, evaluated: { type: 'integer', required: true }, unknown: { type: 'integer', required: true } },
      },
      render: (_a, v) => [{ type: 'text', text: String(v?.report ?? '') }],
    },
    async execute(args) {
      const hours = Number(args?.window_hours) > 0 ? Number(args.window_hours) : cfg.windowHours
      const policy = source.policy
      const facts = buildFacts(hours)
      const rows = evaluate(policy, facts)
      const unknown = rows.filter((r) => r.status === 'unknown').length
      return { report: render(policy, facts, rows, source), evaluated: rows.length - unknown, unknown }
    },
  })
}
