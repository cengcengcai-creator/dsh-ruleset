/**
 * dsh-ruleset —— 把「工作纪律」变成可观测证据。
 *
 * 一个 policy 文件同时喂两层：
 *   inject 层：把规则注入 systemPrompt（让规则被知道）
 *   observe 层：把规则变成三值判定（pass / violation / unknown，证据指回 seq）
 *
 * 边界：只判 agent 行为，不判插件质量（那是 dsh-standards/PerryLink 的领域）。
 */
import { resolveRuleSource } from './source.js'
import { composeSection } from './inject.js'
import { registerReportTool } from './observe.js'

export const name = 'dsh-ruleset'
export const inject = ['systemPrompt', 'tools']

export function apply(ctx, config = {}) {
  const cfg = {
    policyPath: typeof config.policyPath === 'string' ? config.policyPath : '',
    injectMode: ['compact', 'full', 'off'].includes(config.injectMode) ? config.injectMode : 'compact',
    windowHours: Number(config.windowHours) > 0 ? Number(config.windowHours) : 720,
  }
  const source = resolveRuleSource(cfg.policyPath)

  ctx.effect(() => ctx.systemPrompt.section({
    name: 'STANDARDS',
    order: 498,
    text: () => composeSection(cfg.injectMode, source.policy),
  }))

  ctx.effect(() => registerReportTool(ctx, cfg, source))
}
