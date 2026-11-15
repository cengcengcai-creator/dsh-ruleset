/**
 * 规则来源解析：policy.yaml → AGENTS.md（自动抽取为 draft）→ 无。
 * draft 模式只注入、不判定：所有规则状态 unknown，并明确告诉用户怎么确认。
 */
import fs from 'node:fs'
import path from 'node:path'
import { loadPolicy } from './policy.js'
import { extractFromAgents } from './extract.js'

const home = () => process.env.HOME || ''

function firstExisting(paths) {
  return paths.find((p) => { try { return p && fs.existsSync(p) } catch { return false } }) || ''
}

export function resolveRuleSource(explicitPolicy = '') {
  // 显式指定路径时不允许回落：读不到就是 none，避免拿别的 policy 冒充
  if (explicitPolicy) {
    if (!fs.existsSync(explicitPolicy)) return { kind: 'none', policy: null, file: explicitPolicy, warnings: [`指定的 policy 不存在：${explicitPolicy}`] }
    const policy = loadPolicy(explicitPolicy)
    if (policy) return { kind: 'policy', policy, file: explicitPolicy, warnings: [] }
    return { kind: 'none', policy: null, file: explicitPolicy, warnings: [`policy 校验失败：${explicitPolicy}`] }
  }
  const policyFile = firstExisting([
    explicitPolicy,
    process.env.DSH_RULESET_POLICY || '',
    path.join(home(), '.dsh', 'workspace', 'policy.yaml'),
  ])
  if (policyFile) {
    const policy = loadPolicy(policyFile)
    if (policy) {
      // 即使规则来自 policy，也读一下 AGENTS.md，供注入去重用
      const agentsFile = firstExisting([
        process.env.DSH_RULESET_AGENTS || '',
        path.join(home(), '.dsh', 'workspace', 'AGENTS.md'),
      ])
      let agentsText = ''
      try { if (agentsFile) agentsText = fs.readFileSync(agentsFile, 'utf8') } catch { /* 读不到就当没有 */ }
      return { kind: 'policy', policy, file: policyFile, agentsFile, agentsText, warnings: [] }
    }
    return { kind: 'none', policy: null, file: policyFile, warnings: [`policy 读取/校验失败：${policyFile}`] }
  }

  const agentsFile = firstExisting([
    process.env.DSH_RULESET_AGENTS || '',
    path.join(home(), '.dsh', 'workspace', 'AGENTS.md'),
    path.join(process.cwd(), 'AGENTS.md'),
  ])
  if (agentsFile) {
    try {
      const text = fs.readFileSync(agentsFile, 'utf8')
      const res = extractFromAgents(text, path.basename(agentsFile))
      const policy = {
        version: 1,
        meta: { draft: true, source: agentsFile, extractedAt: new Date().toISOString() },
        rules: res.rules,
      }
      return {
        kind: 'agents-draft',
        agentsFile,
        agentsText: text,
        policy,
        file: agentsFile,
        counts: res.byClass,
        warnings: [`规则来自 ${path.basename(agentsFile)} 的自动抽取（${res.total} 条），尚未确认，只注入不判定`],
      }
    } catch (e) {
      return { kind: 'none', policy: null, file: agentsFile, warnings: [`AGENTS.md 抽取失败：${e.message}`] }
    }
  }
  return { kind: 'none', policy: null, file: '', warnings: ['未找到 policy.yaml 或 AGENTS.md'] }
}

/** 给普通用户的引导：三步走，可复制。 */
export function guidanceFor(source) {
  if (source.kind === 'policy') return []
  if (source.kind === 'agents-draft') {
    return [
      '## 需要你确认（当前为草稿）',
      '',
      `1. 你的规则目前从 \`${path.basename(source.file)}\` 自动抽取，共 ${source.policy.rules.length} 条；它们只被注入提示词，**不参与判定**`,
      '2. 生成可编辑的草稿：`node scripts/extract.mjs AGENTS.md policy.draft.yaml`',
      '3. 删掉不想要的、给关键几条补上 `observe.bind`，改名为 `policy.yaml` 放到 `~/.dsh/workspace/`；重启后规则即参与判定',
    ]
  }
  return [
    '## 还没有规则来源',
    '',
    '1. 立刻可用：把 `examples/policy.starter.yaml` 复制成 `~/.dsh/workspace/policy.yaml`',
    '2. 或从自己的 AGENTS.md 抽取：`node scripts/extract.mjs AGENTS.md policy.draft.yaml`',
    '3. 什么都不做也可以：插件不会误判，报告会一直显示「无规则来源」',
  ]
}
