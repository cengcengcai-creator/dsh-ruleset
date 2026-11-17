/** 把判据参数翻译成一句人话，给非程序员看。 */
export function explainBind(bind) {
  if (!bind || !bind.type) return '这条规则没有机械判据，只会作为提示注入，不参与判定。'
  switch (bind.type) {
    case 'explain-first':
      return '检查每一轮里，第一次调用工具之前有没有先写解释/计划；没有就算违规。'
    case 'path-boundary':
      return `检查命令里是否出现「${bind.pattern || 'rm -rf'}」并且删的是工作区外的路径${bind.exemptPaths?.length ? `（已豁免：${bind.exemptPaths.join('、')}）` : ''}，且没有先征求同意。`
    case 'field-presence':
      return `检查${bind.ext || '.md'}文件里是否同时出现这些字段：${(bind.fields || []).join('、') || '（未填写）'}；缺一即违规。`
    case 'count-threshold':
      return `同一条命令连续失败 ${bind.consecutiveFailures ?? 2} 次后仍在重试，就算违规。`
    case 'turn-condition':
      return `当一轮里调用工具超过 ${bind.ifTurnCallMin ?? 12} 次（算长任务）时，必须出现「${bind.thenPattern || '（未填写）'}」这个动作，否则违规。`
    case 'sequence-order':
      return `对匹配「${bind.taskPattern || '（未填写）'}」的任务，前面必须先有 ${(bind.first || []).join('/')}，之后才允许 ${(bind.then || []).join('/')}；样本少于 ${bind.minSamples ?? 10} 条时不判定。`
    case 'requires':
      return `当内容匹配「${bind.ifPathPattern || bind.ifContentPattern || '（未填写）'}」时，必须同时出现规定的伴随动作，否则违规。`
    case 'duration':
      return `单次调用阻塞超过 ${bind.minMinutes ?? 10} 分钟且没有转后台，就算违规。`
    case 'metric':
      return `平台指标 ${bind.key || 'context_ratio'} 必须 ${bind.op || '<='} ${bind.threshold ?? 0.4}${bind.key === 'context_ratio' ? `（即 ${Math.round((bind.threshold ?? 0.4) * 100)}%）` : ''}，超过就违规。`
    case 'regex':
      return `在${(bind.sources || ['commands']).includes('fileWrites') ? '写入的内容' : '命令'}里匹配「${bind.pattern || '（未填写）'}」时算命中。`
    default:
      return `判据 ${bind.type}（暂无白话说明）。`
  }
}
