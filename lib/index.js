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
import { registerCommands } from './commands.js'
import { registerGuard } from './guard.js'
import { recordInjected } from './injected-log.js'
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
  // 段名不能与 dsh-standards 的 STANDARDS 重合，否则注册抛错会让整个 apply 失败
  try {
    ctx.effect(() => ctx.systemPrompt.section({
      name: 'RULESET',
      order: 499,
      text: () => {
        const text = composeSection(mode, { rules: kept })
        if (text) recordInjected(text, { rules: kept.length, mode })
        return text
      },
    }))
  } catch (e) {
    try { ctx.logger?.warn?.(`[ruleset] 注入段注册失败（可能同时装了 dsh-standards）：${e?.message || e}`) } catch { /* ignore */ }
  }

  try {
    if (cfg.playbook !== false) {
      ctx.effect(() => ctx.systemPrompt.section({
        name: 'RULESET-PLAYBOOK',
        order: 497,
        text: () => [
          '# 写规则时的判据经验（ruleset 内置）',
          '- 先定审计对象（命令/文件/轮次/记录），再用 pathPattern 与 excludePath 收窄；不收窄会命中无关文件。',
          '- 正则必须段首锚定并跳过引号内文本；不要用宽泛关键词（曾导致 195/195 全误报）。',
          '- 能靠平台事实就别猜：审批看 approval/*，子会话看 sandbox/mode，后台看 job/*，时长看 turn/*。',
          '- 红线类优先 approval-gated；语义规则（拿不准先问、指不到证据不写结论）保持仅提示，不要硬编判据。',
          '- 误报要能标记并扣减；变化要与基线比（强度<1.96 视为无明显变化）；噪声大的降级为 stat。',
          '- 规则有成本：每条都进提示词，超 20 条应考虑合并；定期跑规则体检。',
        ].join('\n'),
      }))
    }
  } catch { /* section 注册失败不影响其它能力 */ }
  ctx.effect(() => registerReportTool(ctx, cfg, source))
  ctx.effect(() => registerRoutes(ctx, (level, msg) => { try { ctx.logger?.[level]?.(`[ruleset] ${msg}`) } catch { /* ignore */ } }))
  try { ctx.effect(() => registerCommands(ctx)) } catch { /* commands 服务可能不存在 */ }
  try { ctx.effect(() => registerGuard(ctx, cfg)) } catch { /* 事件不存在时忽略 */ }
}
