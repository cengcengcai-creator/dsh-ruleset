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
import { dedupeRules } from './dedupe.js'
import { registerRoutes } from './routes.js'
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

  // 草稿来源（AGENTS.md）已被 DSH 注入 → 默认不再重复注入
  const autoOff = source.kind === 'agents-draft'
  const mode = cfg.injectMode === 'off' || autoOff ? 'off' : cfg.injectMode
  const { kept, skipped } = dedupeRules(source.policy?.rules || [], source.agentsText)
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'STANDARDS',
    order: 498,
    text: () => composeSection(mode, { rules: kept }),
  }))

  ctx.effect(() => registerReportTool(ctx, cfg, source))
  ctx.effect(() => registerRoutes(ctx, (level, msg) => { try { ctx.logger?.[level]?.(`[ruleset] ${msg}`) } catch { /* ignore */ } }))
}
