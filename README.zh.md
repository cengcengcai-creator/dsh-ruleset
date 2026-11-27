<div align="center">

[![npm 版本](https://img.shields.io/npm/v/dsh-ruleset.svg)](https://www.npmjs.com/package/dsh-ruleset)
[![npm 周下载](https://img.shields.io/npm/dw/dsh-ruleset.svg)](https://www.npmjs.com/package/dsh-ruleset)
[![许可证](https://img.shields.io/npm/l/dsh-ruleset.svg)](LICENSE)
[![测试](https://github.com/cengcengcai-creator/dsh-ruleset/actions/workflows/test.yml/badge.svg)](https://github.com/cengcengcai-creator/dsh-ruleset/actions/workflows/test.yml)

</div>

# dsh-ruleset

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
lib/observe.js   ruleset_audit 工具
lib/facts.js     平台事实流（命令/审批/写入/子代理/作业/指标）
lib/predicates.js 九类谓词执行器
lib/report.js    三值判定与渲染
```

参见 [docs-schema.md](docs-schema.md) 与 [ALIGNMENT.md](ALIGNMENT.md)（与手写采集器的逐条对照）。

## 来源与声明

本包由 **AI agent（DeepSeek Harness 作为主要执行者）开发**：在本机真实运行中迭代、按失败纠正，而不是人工手写的提示词模板。它引用的方法论仓库同样如此。请把它当成起点，而不是认证。

插件不内置规则手册。规则来自用户自己的 `policy.yaml`；这里提供的是 schema、谓词执行器和证据采集。


## 只有 AGENTS.md 也能用

多数人的规则是在对话里慢慢攒进 `AGENTS.md` 的，不是按工程规范写的。插件按三种情况处理：

1. 有 `policy.yaml` → 直接用它
2. 没有，但有 `AGENTS.md` → 自动抽取成**草稿**：注入提示词，但**不判定**（每条都报 unknown，注明“草稿未确认”）
3. 两者都没有 → 什么都不判，报告明确写“无规则来源”，不猜

把草稿升级成真规则：

```bash
node scripts/extract.mjs AGENTS.md policy.draft.yaml   # 82 条强制句 → 分类草稿
# 删掉不要的，给关键的几条补上 observe.bind，改名为 policy.yaml
```

起步包在 `examples/policy.starter.yaml`（5 条最常被违反、且能机械判的规则）。

## 可插拔：不碰用户文件

- 插件**从不写** `AGENTS.md`、`policy.yaml` 或任何用户文件，全部在调用时只读。
- 卸载后提示词原样恢复：注册走 `ctx.effect`，随插件一起 dispose。
- 注入与 `AGENTS.md` 去重：规则文本若已出现在 AGENTS.md 里，就**不再重复注入**（报告显示 `注入 N 条 / 跳过 M 条`）；规则本身就来自 AGENTS.md 时，注入层自动关闭。

## 工具

- `ruleset_audit` — 输出最近 N 小时的三值报告，同时写一份 `.ruleset/report.json`（插件自有状态，不是用户文件），供 UI 或外部读取。
- `ruleset_init` — 仅在你明确要求时：把 `AGENTS.md` 抽取成 `.ruleset/policy.draft.yaml`。永不触碰正式 `policy.yaml`；草稿已存在时需 `overwrite: true` 才覆盖。

## 现在的功能（2026-11）

1. **一句话写规则**：模型拆成判据，可手调；模型不可用时走确定性兜底
2. **三档分级**：红线 / 硬约束 / 软规则，注入按此顺序，硬规则不会被埋
3. **判行为**：15 类判据，优先用 DSH 原生事件（审批、沙箱模式、后台任务、轮次、写入），不拿正则猜平台已有的事实
4. **拦红线**：`tools/pre-execute` 守卫对 `sudo`、`chmod 777`、`curl | sh`、系统目录写入、凭据形态返回 `ask`，命中记入 `.ruleset/guard.log`
5. **发现可维护**：每条发现可标 误报/已修/接受，误报从命中里扣减且永不删除；7 天后自动 supersede
6. **与基线比**：两比例 z 检验（移植自 OpenClaw 的 `audit-verdict.py`），`|z|<1.96` 显示「无明显变化」而不是飘红
7. **注入可核**：每次真正注入的规则文本都会留指纹（`.ruleset/injected.log`）
8. **不拥有你的规则**：`AGENTS.md` 只读；`policy.yaml` 只在显式操作时写，写前自动备份，支持一键回滚与导出

规则体检：重复、冲突、无判据、token 成本。测试：`npm test`（20 条）。

已知限制：无热插拔（改插件需重启宿主）、客户端 slot props 无法查询、模型复核仅供参照（未做 kappa 校准）。

## 社区收录

已收录：

1. **[awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)** ——“Security & Permissions”分类（2026-11-18 合并，[PR #16379](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/16379)）；该列表同时是应用内插件市场的索引源

审核中：

1. [kejixiaoliang/awesome-dsh-plugins](https://github.com/kejixiaoliang/awesome-dsh-plugins/pull/223)——健康检查 / 诊断 / 审计分类

已发布到 npm：[`dsh-ruleset`](https://www.npmjs.com/package/dsh-ruleset)：

```bash
dsh plugin --profile web add dsh-ruleset
```
