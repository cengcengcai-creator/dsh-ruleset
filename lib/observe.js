/** 观测层：注册 observe_report 工具。判定只给三值，证据指回 seq / 文件。 */
import { runAudit } from './run.js'
import { createService } from './service.js'
import { parseSentence } from './extract.js'
import { parseWithLlm } from './llm-parse.js'
import { introspectRule } from './introspect.js'
import { resolveRuleSource } from './source.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { initDraft } from './init.js'

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
      const hours = Number(args?.window_hours) > 0 ? Number(args.window_hours) : cfg.windowHours
      const { payload, text } = runAudit({ windowHours: hours, policyPath: cfg.policyPath })
      return { report: text, evaluated: payload.rows.length - payload.summary.unknown, unknown: payload.summary.unknown }
    },
  })
  const reportTool = ctx.tools.register({
    name: 'ruleset_audit',
    description: '按规则做验证与报告：读 policy 与会话轨迹，输出三值（pass/violation/unknown）。unknown 表示无数据源或样本不足，不得读作 pass。',
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
      const { payload, text } = runAudit({ windowHours: hours, policyPath: cfg.policyPath })
      return { report: text, evaluated: payload.rows.length - payload.summary.unknown, unknown: payload.summary.unknown }
    },
  })
  const svc = createService(ctx)

  const parseTool = ctx.tools.register({
    name: 'ruleset_parse',
    description: '把一句规则描述解析成可机械判定的判据（优先用宿主模型，失败回落规则匹配）。返回来源 by=llm|heuristic。',
    parameters: { text: { type: 'string', description: '一句话规则描述' } },
    output: {
      schema: {
        type: 'object',
        additionalProperties: true,
        required: ['by', 'classification'],
        properties: {
          by: { type: 'string' },
          classification: { type: 'string' },
          question: { type: 'string' },
          explain: { type: 'string' },
        },
      },
      render: (_a, v) => [{ type: 'text', text: `${v?.by} · ${v?.classification}\n${JSON.stringify(v?.bind ?? null)}\n${v?.reason || v?.explain || v?.question || ''}` }],
    },
    async execute(args) {
      const res = await svc.parse({ text: String(args?.text || '') })
      const v = res.value || {}
      return { by: v.by || 'heuristic', classification: v.classification || 'process', bind: v.bind ?? {}, question: v.question || '', explain: v.reason || v.explain || '' }
    },
  })
  const introspectTool = ctx.tools.register({
    name: 'ruleset_introspect',
    description: '让模型逐条说明规则审计的对象/触发/期望/例外，并给出可机械化的判据建议。',
    parameters: {
      id: { type: 'string', description: '只分析这条规则；省略则分析前 N 条' },
      limit: { type: 'integer', description: '未给 id 时分析多少条，默认 3' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['summary'],
        properties: { summary: { type: 'string' } },
      },
      render: (_a, v) => [{ type: 'text', text: String(v?.summary || '') }],
    },
    async execute(args) {
      const res = await svc.introspect({ id: args?.id, limit: args?.limit })
      const items = res.value?.items || []
      const lines = []
      for (const x of items) {
        if (x.error) { lines.push(`${x.id}: 失败 ${x.error}`); continue }
        lines.push(`${x.id}（${x.title || ''}）`)
        lines.push(`  对象=${x.object}｜触发=${x.trigger}`)
        lines.push(`  期望=${x.expectation}｜例外=${x.exceptions || '无'}`)
        lines.push(`  可机械化=${x.mechanical}${x.bind ? `｜建议=${x.bind.type}` : ''}｜${x.why}`)
      }
      return { summary: lines.join('\n') }
    },
  })
  const playbookTool = ctx.tools.register({
    name: 'ruleset_playbook',
    description: '读取 dsh-ruleset 内置的「判据选用手册」：对象怎么定、正则怎么写、哪些规则不该硬编判据。',
    parameters: {},
    output: {
      schema: { type: 'object', additionalProperties: false, required: ['text'], properties: { text: { type: 'string' } } },
      render: (_a, v) => [{ type: 'text', text: String(v?.text || '') }],
    },
    async execute() {
      try {
        const here = path.dirname(fileURLToPath(import.meta.url))
        return { text: fs.readFileSync(path.join(here, '..', 'docs', 'PREDICATE-PLAYBOOK.md'), 'utf8') }
      } catch (e) {
        return { text: '读取失败：' + (e?.message || String(e)) }
      }
    },
  })
  return () => { initTool?.(); reportTool?.(); parseTool?.(); introspectTool?.(); playbookTool?.() }
}
