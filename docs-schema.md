# policy schema

```yaml
version: 1
platform: { context_yellow_ratio: 0.4 }
rules:
  - id: kebab-case-id          # required, unique
    kind: constraint|protocol  # required
    title: short label         # required
    text: one-line rule        # required
    mechanism: instruction|hook|tool
    observe:
      metric: name             # required by convention
      expect: 0
      bind:                    # optional: makes the rule mechanically checkable
        type: <predicate>
        ...predicate options
```

## Predicates

| type | options | verdict |
|---|---|---|
| `regex` | `sources` (`commands`/`fileWrites`), `pattern`, `target` (`cmd`/`content`/`path`), `skeleton`, `excludeLocalUrl`, `requireWrite`, `requireApproval`, `requireUserPermit` | 命中且无许可 → violation；扫描到样本 0 命中 → pass |
| `path-boundary` | `pattern`, `requireApproval`, `requireUserPermit` | 目标越出会话 cwd 且无审批 → violation |
| `field-presence` | `ext`, `fields`, `pathPattern`, `excludePath`, `legacyDays` | 文件缺字段 → violation；legacy 只统计不判定 |
| `sequence-order` | `taskPattern`, `first`, `then`, `minSamples` | 未先检索 → violation；样本不足 → unknown |
| `count-threshold` | `consecutiveFailures`, `minSamples` | 连续失败后仍重试 → violation |
| `requires` | `ifPathPattern`, `ifContentPattern` | 做了 X 无 Y → violation |
| `turn-condition` | `ifTurnCallMin`, `thenPattern` | 长任务无收尾动作 → violation |
| `duration` | `minMinutes` | 阻塞超阈值且未后台化 → violation |
| `metric` | `key`, `op`, `threshold` | 平台指标越界 → violation |

## Contract

- 没有 `bind` 的规则一律 `unknown`（语义规则就该承认判不了）
- `unknown` 不得读作 `pass`
- 每条 violation 必须能指回 `seq` 或文件路径
