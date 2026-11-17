# Development notes

> 这份文档记录 dsh-ruleset 的设计取舍、踩过的坑，以及为什么现在是这样。
> 目标读者：接手这个插件的开发者，或者想自己写行为审计插件的人。

## 1. 这个插件解决什么问题

`AGENTS.md` / `policy` 类文件本质上只是**提示**。业界抱怨集中在四点：

1. 规则只是建议，模型可以忘、可以误用、可以被注入文本说服
2. 规则越写越多，没人敢删，遇到冲突时模型要猜优先级
3. 文件越长，注意力越稀释（Lost in the Middle），成本还上涨
4. 没人知道这次到底哪条规则进了模型、有没有生效

dsh-ruleset 的定位不是再写一份规则文件，而是把规则变成**可判、可拦、可核**的东西。

## 2. 三层结构

```
policy.yaml  ──注入──▶  system prompt（按 tier 分段）
     │
     ├──判定──▶ predicates（机械判据） + 模型复核（仅语义规则）
     ├──拦截──▶ tools/pre-execute 守卫（红线命中→ask）
     └──记账──▶ findings.json / baseline.json / injected.log / guard.log
```

所有操作实现都收在 `lib/service.js`，工具、HTTP 路由、宿主命令三个入口都是薄适配层。

## 3. 关键取舍

### 3.1 三值 + 分级，而不是二元

- 状态：`pass / violation / warn / stat / unknown`
- `unknown` 绝不当作 `pass`：没有数据就是没有数据
- 严重度：`red`（红线）/ `yellow`（硬约束）/ `stat`（只统计不飘红）

### 3.2 显著性判定（移植自 OpenClaw 的 audit-verdict）

红线之外的变化要和基线比，`|z| < 1.96` 视为无明显变化。这条解决的是"累积一定飘红"的伪问题——不是靠调容忍度，而是靠统计上是否真的变差。

### 3.3 误报是长期成本

发现记录有生命周期：`open / fixed / accepted / false_positive / superseded`。误报**永不删除**，标记后从命中里扣减。没有这条，数字会永久失真。

### 3.4 插件不拥有用户的规则文件

三条硬原则：

1. **AGENTS.md 只读**：插件从不修改它，只在没有 policy 时读取并生成到 `.ruleset/policy.draft.yaml`
2. **policy.yaml 只在显式操作时写**：用户在面板点保存、或调用工具时才写；写前自动备份到 `.ruleset/backups/`
3. **卸载不带走能力**：「导出」按钮把 policy 与 AGENTS.md 复制到 `.ruleset/export/`，卸载前用户能完整取回

配套机制：

| 机制 | 作用 |
|---|---|
| `backupPolicy()` | 每次写前留快照，索引写入 `backups/index.json` |
| 回滚 | 选中任一份备份还原；**回滚前再备份**（`pre-restore`），避免回滚不可逆 |
| `exportForKeep()` | 导出 policy + AGENTS.md，供卸载后保留 |

这条原则的由来：审计工具最容易被怀疑“会不会改我的东西”。宁可多一步备份，也不要让用户担心文件被接管。

### 3.5 拦截用 ask，不用硬拒绝

`tools/pre-execute` 返回 `ask`：能拦，但你能临时放行。`ctx.tools.guard()` 是不可逆拒绝，弹性太差，只在真正零容忍的场景考虑。

## 4. 传输层演进（重要）

1. 最早用 `connection.fetch.register` 注册 HTTP 路由，web 端正常
2. 桌面端 `dsh-app://` 下这些路由全部 404——不是插件没加载，是该协议下没有这条通道
3. 排查过程走了弯路：先怀疑插件加载失败，再到 profile 里装 inspector 包（无效，那两个包不是 bundle）
4. 最终方案：`lib/commands.js` 注册 `/ruleset <json>` 命令，客户端先试命令通道、失败再回 HTTP
5. 结论：`connection.fetch.register` 本身是官方 API，但**不是所有运行时都具备**

教训：不要假设某个服务在所有宿主里都存在，要么探测能力，要么准备回退。

## 5. 判据实现踩过的坑

| 坑 | 现象 | 修法 |
|---|---|---|
| 宽泛正则 | `来源\|sources` 命中 195/195 | 改用字段级 `field-presence` |
| 匹配对象过宽 | 调研规则把 `AGENTS.md` 当调研记录 | 加 `pathPattern` + `excludePath` |
| 命令文本里的字面量 | `python3 -c "…sudo…"` 被当命令 | 段首锚定 + 引号感知 |
| JS 不支持 `(?s)` | 整条判据报错 | 编译前转换 |
| 基数不是事件数 | 同一份记录被判多次 | 按文件去重、事故合并（15s 窗口） |
| 跨窗口重复 | 同一问题因窗口变化反复出现 | supersede + 稳定键 |

## 6. 已发生的"整包不加载"故障

宿主侧任何一处不合规都会让整个插件静默不加载，而客户端 bundle 仍是旧的，表现为"面板在、接口全 404"。

已踩到三次：

1. `package.json` 的 `exports` 键写成 `'."'`
2. 工具输出 schema 用了属性级 `required: true`
3. `routes.js` / `observe.js` 重复 `import` 同一标识符

防线：`test/load.test.mjs` 会真的 `import` 插件并断言工具与路由都注册成功。

## 7. 测试

```bash
npm test          # 20 条：校验、判据、抽取、去重、加载、守卫
```

新增判据时至少补三条：命中、放行、不该命中的边界。

## 8. 已知问题

1. 改插件必须重启宿主进程，没有热插拔（DSH 的 HMR 只覆盖构建产物）
2. 客户端 slot props 与主题令牌无法通过 `cordis_inspect` 获取（client provider 未注册）
3. 规则"对象定义"仍分散在判据参数里，没有独立字段
4. 模型复核未做人工校准（无 kappa），目前只作参考、不参与红黄
5. 审计每次全量解压会话（约 48MB/26 会话），会话多了会慢

## 9. 下一步优先级

1. 规则对象字段化（`object: file|command|turn|task`），判据必须声明
2. 注入可核加强：把注入指纹写进会话事件，而不只是插件日志
3. 模型复核抽样 + kappa 校准
4. 性能：改用 session projections，避免全量扫描
