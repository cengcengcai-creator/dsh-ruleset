# 声明式 vs 手写采集器：对齐结果（2026-11-15）

同一批会话日志（23 会话 / 253 轮 / 949 命令），两边逐条对照。

| 规则 | 手写 dsh-observe | 声明式 dsh-ruleset | 结论 |
|---|---|---|---|
| 外发先问 | pass（4/4 有许可） | pass（4/4） | ✅ 一致 |
| 破坏性命令 | violation（1 条越界） | violation（2/17） | 差 1 条：删 /tmp 测试语料时口头同意，谓词只看弹窗 |
| 凭据不落盘 | pass（662 次写调用） | pass（51 次写调用） | 状态一致，样本口径不同（未纳入 bash 重定向写入） |
| 交付物 type | violation（2 判定 / 4 legacy） | violation（3/4 / 3 legacy） | 接近，排除规则细节差异 |
| 记录五必录 | violation（7/9 / 3 legacy） | violation（7/9 / 3 legacy） | ✅ 完全一致 |
| 收尾四步 | violation（15/21） | violation（15/21） | ✅ 完全一致 |
| 同因失败 | pass | pass | ✅ 一致 |
| 长活后台化 | pass（最长 385s） | pass（最长 385s） | ✅ 一致 |
| 交付分级复核 | violation（5） | violation（7） | 匹配范围更宽（把内容里出现"评估"的也算） |
| 上下文轮换 | pass（17.1%） | pass（17.1%） | ✅ 一致 |
| 排查先检索 | unknown（4/10） | unknown（6/10） | 状态一致，分类阈值不同 |
| 四条语义规则 | unknown | unknown | ✅ 一致 |

## 结论

1. 10/15 可用声明式表达，与手写版判定条数相同；其中 8 条状态完全一致，2 条差异可解释。
2. 差异全部来自「证据粒度」：口头确认、写调用口径、复核匹配范围 —— 不是谓词表达力不足。
3. 三个必须记住的实现要点：
   - 显式 policy 路径解析失败必须返回 null，不得回落到别的 policy
   - `expect: 0` 类规则在「有样本、0 命中」时是 pass，不是 unknown
   - 批处理里 user 消息可能出现在 turn/start 之前，必须做 carry-over
