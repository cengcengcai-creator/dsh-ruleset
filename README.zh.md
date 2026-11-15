# dsh-ruleset（草稿）

**把工作纪律变成可观测证据：一份 policy 同时驱动提示词注入与三值判定。**

> 判的是 **agent 的行为**，不是插件的质量。插件合规看 `PerryLink/dsh-standards`（ENTRY/FLOW/BOOST）。

## 与方法论的关系

四层执行深度（拦截 / 退出闸门 / 事后检测 / 仅提示）与「可检测 ≠ 可阻断」来自 [`agent-rule-enforcement`](https://github.com/cengcengcai-creator/agent-rule-enforcement)。**本包只做检测层**：拿日志量行为，不宣称能拦。

互操作：`lib/export.js` 可导出通用事件日志（`ts` / `session` / `tool` / `ok` / `checkpoint` / `outcome`），该仓库的 `audit_events.py` 能直接消费。实测：1,138 条事件 → 40 个任务段 → `long_task_without_checkpoint` 15/40。

## 为什么开源它有意义

市面上两类插件各占一端：

1. 规则注入类（`dsh-tool-policy`、`dsh-security-guard`）：把规矩写进提示词，但没人知道有没有被遵守
2. 观测/审计类（`dsh-observe` 类 OTel 导出、`dsh-dashboard`、`dsh-context-doctor`）：测 token、测工具耗时，但不测“守没守规矩”

缺的是中间那段：**规则说了，到底做到没有**。`dsh-ruleset` 就做这一段，并且坚持两条契约：

- `unknown` 永远不得读作 `pass`
- 每条 violation 必须能指回 `seq` 或文件路径

## 通用性从哪来

规则不内置。用户用 9 类谓词在 policy 里声明判据：

`regex` · `path-boundary` · `field-presence` · `sequence-order` · `count-threshold` · `requires` · `turn-condition` · `duration` · `metric`

我们自己的 15 条规则里，10 条能用声明式表达；剩下 5 条如实标 `unknown`（语义类）。这不是 100%，但是可验证的边界。

## 装法

```bash
# GitHub 直装（现在可用）
dsh plugin --profile web add github:cengcengcai-creator/dsh-ruleset

# npm（发布后可用）
dsh plugin --profile web add dsh-ruleset
```

```yaml
# profiles/<name>/cordis.patch.yml
- insert:
    - id: dsh-ruleset
      name: 'dsh-ruleset'
      config:
        policyPath: ''        # 空 = $DSH_RULESET_POLICY → ~/.dsh/workspace/policy.yaml
        injectMode: compact   # compact | full | off
```

## 设计

```
lib/index.js     接线
lib/policy.js    读取 + 校验 + mtime 热更
lib/inject.js    系统提示词段
lib/observe.js   observe_report 工具
lib/facts.js     平台事实流（命令/审批/写入/子代理/作业/指标）
lib/predicates.js 九类谓词执行器
lib/report.js    三值判定与渲染
```

参见 [docs-schema.md](docs-schema.md) 与 [ALIGNMENT.md](ALIGNMENT.md)（与手写采集器的逐条对照）。

## 来源与声明

本包由 **AI agent（DeepSeek Harness 作为主要执行者）开发**：在本机真实运行中迭代、按失败纠正，而不是人工手写的提示词模板。它引用的方法论仓库同样如此。请把它当成起点，而不是认证。

插件不内置规则手册。规则来自用户自己的 `policy.yaml`；这里提供的是 schema、谓词执行器和证据采集。
