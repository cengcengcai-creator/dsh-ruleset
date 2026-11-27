window.__ModuleLoader__.load({
  id: 'dsh-ruleset',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const PANEL_ID = 'dsh-ruleset'
    const BUILD = 'ui-210829'
    // 浅色毛玻璃主题：白底、深灰字、荧光红绿标识
    const C = {
      canvas: '#ffffff', surface: 'rgba(255,255,255,0.62)', surfaceHover: 'rgba(255,255,255,0.88)',
      line: 'rgba(20,30,45,0.08)', lineStrong: 'rgba(20,30,45,0.18)',
      text: '#333a44', muted: 'rgba(51,58,68,0.60)',
      pass: '#00c48c', violation: '#ff2e63', warn: '#f0a020', stat: '#7c8db5', unknown: '#9aa4b2', accent: '#0b6bff',
      field: 'rgba(255,255,255,0.75)',
    }
    const glow = (c) => `0 0 6px ${c}30`
    const tint = (c) => `linear-gradient(180deg, ${c}0f, ${c}05)`
    const T = { micro: 10, label: 11, body: 12, base: 13, head: 15, kpi: 22 }
    const RAD = { card: 12, ctrl: 8 }

    // 宿主命令通道（桌面端 dsh-app:// 下 HTTP 路由可能不可用）
    let remoteCommands = null
    const viaCommand = async (op, args) => {
      if (!remoteCommands?.execute) return null
      try {
        const ac = new AbortController()
        const exec = remoteCommands.execute
        // 兼容两种签名：execute(line, ...) 或 execute(agent, line, ...)
        let out
        try { out = await exec(`/ruleset ${JSON.stringify({ op, args })}`, [], ac.signal) }
        catch (e1) { out = await exec(null, `/ruleset ${JSON.stringify({ op, args })}`, [], ac.signal) }
        const text = out?.result?.text
        if (typeof text !== 'string') return null
        try { return JSON.parse(text) } catch { return null }
      } catch { return null }
    }

    const post = async (path, body) => {
      const res = await fetch(path, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}),
      })
      const text = await res.text()
      return { res, text }
    }

    const opOf = (path) => String(path || '').replace('api/dsh-ruleset/', '')
    const call = async (path, body) => {
      const viaCmd = await viaCommand(opOf(path), body)
      if (viaCmd) return viaCmd
      let { res, text } = await post(path, body)
      // 相对路径在不同 dsh-app:// 基址下可能被吃掉一段，用绝对路径重试一次
      if (!res.ok && !path.startsWith('/')) {
        const retry = await post('/' + path, body)
        if (retry.res.ok) { res = retry.res; text = retry.text }
        else if (retry.res.status !== 404) { res = retry.res; text = retry.text }
      }
      if (!res.ok) {
        return { ok: false, error: { code: `http-${res.status}`, message: `${path} → HTTP ${res.status} (${res.url}) : ${text.slice(0, 100)}` } }
      }
      try { return JSON.parse(text) } catch { return { ok: false, error: { code: 'bad-json', message: `${path} 返回非 JSON：${text.slice(0, 100)}` } } }
    }

    /* ---------- 迷你图 ---------- */
    const Spark = ({ values, color, w = 64, hgt = 22 }) => {
      const v = values.length ? values : [0, 0]
      const max = Math.max(1, ...v)
      const pt = (i) => {
        const x = v.length === 1 ? w / 2 : (i / (v.length - 1)) * (w - 2) + 1
        const y = hgt - 2 - (v[i] / max) * (hgt - 4)
        return [x, y]
      }
      const line = v.map((_, i) => pt(i).map((n) => n.toFixed(1)).join(',')).join(' ')
      const [lx, ly] = pt(v.length - 1)
      return h('svg', { width: w, height: hgt, style: { display: 'block' } },
        h('polyline', { points: line, fill: 'none', stroke: color, strokeWidth: 1.5, strokeLinejoin: 'round', strokeLinecap: 'round' }),
        h('circle', { cx: lx, cy: ly, r: 1.8, fill: color }))
    }

    /* ---------- 主趋势图 ---------- */
    const TrendChart = ({ series, color }) => {
      const W = 360, H = 84
      const data = series.map((s) => s.summary?.violation ?? 0)
      const max = Math.max(1, ...data)
      const x = (i) => (i / Math.max(1, data.length - 1)) * (W - 2) + 1
      const y = (val) => H - 18 - (val / max) * (H - 26)
      const pts = data.map((val, i) => `${x(i).toFixed(1)},${y(val).toFixed(1)}`)
      const area = `1,${H - 18} ${pts.join(' ')} ${W - 1},${H - 18}`
      const fmt = (iso) => {
        const d = new Date(iso)
        return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00`
      }
      const labels = data.length > 1
        ? [{ i: 0, t: fmt(series[0].at) }, { i: data.length - 1, t: fmt(series[data.length - 1].at) }]
        : []
      return h('svg', { width: '100%', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', style: { display: 'block' } },
        h('line', { x1: 0, y1: H - 18, x2: W, y2: H - 18, stroke: C.line, strokeWidth: 1 }),
        h('polygon', { points: area, fill: 'url(#rulesetTrend)', opacity: 0.9 }),
        h('linearGradient', { id: 'rulesetTrend', x1: 0, y1: 0, x2: 0, y2: 1 },
          h('stop', { offset: '0%', stopColor: color, stopOpacity: 0.35 }),
          h('stop', { offset: '100%', stopColor: color, stopOpacity: 0 })),
        h('polyline', { points: pts.join(' '), fill: 'none', stroke: color, strokeWidth: 2.6, strokeLinejoin: 'round', strokeLinecap: 'round', style: { filter: `drop-shadow(0 0 3px ${color}66)` } }),
        data.map((val, i) => h('circle', { key: i, cx: x(i), cy: y(val), r: 2.6, fill: color, style: { filter: `drop-shadow(0 0 2px ${color}aa)` } },
          h('title', null, `${new Date(series[i].at).toLocaleString()} · 违规 ${val}`))),
        labels.map((l) => h('text', { key: l.t, x: x(l.i), y: H - 4, fontSize: 9, fill: C.muted, textAnchor: l.i === 0 ? 'start' : 'end' }, l.t)),
        h('text', { x: 1, y: 10, fontSize: 9, fill: C.muted }, `峰值 ${max}`))
    }

    /* ---------- 一句话 → 判据（复用宿主侧的规则抽取口径） ---------- */
    const SAY = {
      path: '在工作区外删除文件、且没有先确认',
      field: '文件里缺少指定字段',
      count: '同一条命令连续失败后仍在重试',
      outbound: '外发动作没有先确认',
      'search-first': '诊断/开发任务没有先查外部案例就直接上手',
      artifact: '命令里出现特定脚本/命令',
      semantic: '这条属于语义规则，只能提示，无法机械判定',
      process: '暂未识别出可机械判定的判据',
      empty: '还没有描述',
    }

    const DEFAULT_ALTS = [
      { type: 'field-presence', bind: { type: 'field-presence', ext: '.md', fields: ['sources', 'retrieved_at'] }, say: '记录里必须写清来源列表与检索时间' },
      { type: 'regex', bind: { type: 'regex', sources: ['fileWrites'], pattern: '(?s)sources?.{0,400}' }, say: '写入内容里必须出现来源段落' },
      { type: 'count-threshold', bind: { type: 'count-threshold', consecutiveFailures: 2 }, say: '同一检索连续失败后仍在重试' },
    ]

    const slug = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

    /* ---------- 规则卡片 ---------- */
    const Card = ({ row, series, windowHours, bucket, findings, onTriage, model, open, onToggle, onRemove, onEdit, pending }) => {
      const [hover, setHover] = React.useState(false)
      const color = C[row.status] || C.unknown
      const rates = series.map((s) => s.rules?.[row.id]?.rate ?? 0)
      const rate = row.base ? Math.round(((row.hits || 0) / row.base) * 100) : null
      return h('div', {
        draggable: true,
        title: '可以拖到其他栏改变分级；点一下展开详情',
        onDragStart: (e) => { try { e.dataTransfer.setData('text/plain', row.id); e.dataTransfer.effectAllowed = 'move' } catch { /* ignore */ } },
        onClick: onToggle,
        onMouseEnter: () => setHover(true),
        onMouseLeave: () => setHover(false),
        style: {
          position: 'relative',
          borderStyle: 'solid',
          borderTopWidth: 1, borderRightWidth: 1, borderBottomWidth: 1, borderLeftWidth: 3,
          borderTopColor: hover ? C.lineStrong : C.line,
          borderRightColor: hover ? C.lineStrong : C.line,
          borderBottomColor: hover ? C.lineStrong : C.line,
          borderLeftColor: color,
          borderRadius: RAD.card,
          backgroundImage: `${tint(color)}, ${hover ? 'linear-gradient(rgba(255,255,255,0.9), rgba(255,255,255,0.9))' : 'linear-gradient(rgba(255,255,255,0.55), rgba(255,255,255,0.55))'}`,
          backdropFilter: 'blur(14px) saturate(1.4)', WebkitBackdropFilter: 'blur(14px) saturate(1.4)',
          padding: '11px 12px 10px 13px', cursor: 'pointer',
          boxShadow: hover ? '0 6px 18px rgba(20,30,45,0.10)' : '0 1px 2px rgba(20,30,45,0.05)',
          gridColumn: open ? '1 / -1' : 'auto', transition: 'background .14s, border-color .14s, box-shadow .14s',
        },
      },
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 6 } },
          h('span', { style: { fontSize: T.body, fontWeight: 600, flex: 1, lineHeight: 1.35, letterSpacing: '-0.005em' } }, row.title || row.id),
          h('span', { style: { fontSize: T.micro, color, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500 } }, row.status),
          h('span', {
            onClick: (e) => { e.stopPropagation(); onEdit(row) },
            title: '编辑这条规则',
            style: { fontSize: 11, color: C.muted, cursor: 'pointer', padding: '0 3px' },
          }, '编辑'),
          h('span', {
            onClick: (e) => { e.stopPropagation(); onRemove(row) },
            title: pending ? '再点一次确认删除' : '删除这条规则',
            style: { fontSize: pending ? 10 : 13, color: pending ? C.violation : C.muted, cursor: 'pointer', padding: '0 2px', lineHeight: 1, whiteSpace: 'nowrap' },
          }, pending ? '确认删除?' : '×')),
        h('div', { style: { display: 'flex', alignItems: 'flex-end', gap: 8, marginTop: 6 } },
          h('span', { style: { fontSize: 20, fontWeight: 600, lineHeight: 1, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' } }, rate === null ? '–' : `${rate}%`),
          h('span', { style: { fontSize: T.micro, color: C.muted, paddingBottom: 2 } }, row.base ? `命中 ${row.hits} / 样本 ${row.base}` : '窗口内无样本'),
          row.z !== undefined ? h('span', {
            style: { fontSize: T.micro, paddingBottom: 2, color: row.z < -1.96 ? C.violation : row.z > 1.96 ? C.pass : C.muted },
          }, row.z < -1.96 ? `比基线明显变差（强度 ${Math.abs(row.z)}）` : row.z > 1.96 ? `比基线明显变好（强度 ${row.z}）` : `与基线无明显变化（强度 ${Math.abs(row.z)}）`) : null,
          h('div', { style: { marginLeft: 'auto' } }, rates.length > 1 ? h(Spark, { values: rates, color }) : null)),
        open ? h('div', { style: { marginTop: 8, borderTop: `1px solid ${C.line}`, paddingTop: 8, fontSize: 11, color: C.muted, lineHeight: 1.75 } },
          row.text ? h('div', { style: { marginBottom: 6 } }, h('strong', { style: { color: 'inherit' } }, '规则原文：'), row.text) : null,
          h('div', { style: { marginBottom: 6 } }, h('strong', null, '怎么判：'), row.explain || '（无）'),
          (row.bindTypes || (row.bindType ? [row.bindType] : [])).length
            ? h('div', { style: { marginBottom: 6 } }, h('strong', null, '判定方式：'), (row.bindTypes || [row.bindType]).join(' + '))
            : h('div', { style: { marginBottom: 6, color: C.muted } }, '判定方式：无（仅提示，不参与判定）'),
          h('div', { style: { marginBottom: 6 } },
            h('strong', null, '取样周期：'),
            `统计窗口 ${windowHours >= 24 ? `${Math.round(windowHours / 24)} 天` : `${windowHours} 小时`} · 曲线按${bucket === 'week' ? '周' : bucket === 'day' ? '天' : '小时'}聚合 · 当前 ${series.length || 1} 个点`,
            series.length > 1 ? h('div', { style: { marginTop: 6 } }, h(Spark, { values: series.map((x) => x.rules?.[row.id]?.rate ?? 0), color, w: 260, hgt: 42 })) : null,
            series.length > 1 ? h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 9, opacity: 0.7, width: 260 } },
              h('span', null, new Date(series[0].at).toLocaleTimeString()), h('span', null, new Date(series[series.length - 1].at).toLocaleTimeString())) : null),
          row.detail ? h('div', { style: { marginBottom: 6 } }, h('strong', null, '本次结果：'), row.detail) : null,
          row.z !== undefined ? h('div', { style: { marginBottom: 6 } }, h('strong', null, '显著性：'), `z=${row.z}（|z|<1.96 视为与基线无显著差异）`) : null,
          model ? h('div', { style: { marginBottom: 6 } },
            h('strong', null, '模型复核：'),
            h('span', { style: { color: model.verdict === 'violation' ? C.violation : model.verdict === 'pass' ? C.pass : C.muted } }, model.verdict),
            ` ${model.reason || ''}`,
            model.evidence ? h('div', { style: { fontSize: 10, opacity: 0.75 } }, model.evidence) : null) : null,
          (findings || []).filter((f) => f.ruleId === row.id && f.status === 'open').length ? h('div', { style: { marginBottom: 6 } },
            h('strong', null, '待处理发现：'),
            findings.filter((f) => f.ruleId === row.id && f.status === 'open').slice(0, 8).map((f) => h('div', { key: f.key, title: f.evidence || '', style: { display: 'flex', gap: 6, alignItems: 'baseline', padding: '3px 0' } },
              h('span', { style: { fontSize: 9, padding: '0 6px', borderRadius: 999, border: `1px solid ${f.level === 'red' ? C.violation : '#e8a33d'}`, color: f.level === 'red' ? C.violation : '#b8791f' } }, f.level),
              h('span', { style: { fontSize: 9, padding: '0 6px', borderRadius: 999, background: f.status === 'open' ? 'rgba(255,46,99,0.10)' : 'rgba(0,196,140,0.12)', color: f.status === 'open' ? C.violation : C.pass } }, f.status),
              h('span', { style: { flex: 1, fontSize: 10.5, lineHeight: 1.5, opacity: 0.9, whiteSpace: 'normal', wordBreak: 'break-word' } },
                String(f.evidence || '').split(' · ').map((seg, si) => h('span', {
                  key: si,
                  style: si === 0 ? { color: C.muted, marginRight: 6 } : { marginRight: 6 },
                }, seg))),
              h('button', { onClick: (e) => { e.stopPropagation(); onTriage(f.key, 'false_positive') }, style: { fontSize: 9, padding: '1px 6px', borderRadius: 5, border: `1px solid ${C.line}`, background: 'transparent', color: C.muted, cursor: 'pointer' } }, '误报'),
              h('button', { onClick: (e) => { e.stopPropagation(); onTriage(f.key, 'fixed') }, style: { fontSize: 9, padding: '1px 6px', borderRadius: 5, border: `1px solid ${C.line}`, background: 'transparent', color: C.muted, cursor: 'pointer' } }, '已修'),
              h('button', { onClick: (e) => { e.stopPropagation(); onTriage(f.key, 'accepted') }, style: { fontSize: 9, padding: '1px 6px', borderRadius: 5, border: `1px solid ${C.line}`, background: 'transparent', color: C.muted, cursor: 'pointer' } }, '接受')))) : null,
          (row.samples || []).length ? h('div', null, h('strong', null, '证据：'),
            (row.samples || []).slice(0, 3).map((s, i) => h('div', { key: i, style: { fontFamily: 'ui-monospace, monospace', fontSize: 10, opacity: 0.85 } },
              `· ${s.id || s.file || s.seq || ''} ${s.session ? `(${s.session})` : ''}`))) : null,
        ) : null,
      )
    }

    /* ---------- 新增规则卡片：模型拆解 + 手调 ---------- */
    const FALLBACK_TYPES = [
      { type: 'path-boundary', say: '命令删除了工作区外的路径且没先确认' },
      { type: 'field-presence', say: '文件里缺少指定字段' },
      { type: 'count-threshold', say: '同一命令连续失败后仍在重试' },
      { type: 'turn-condition', say: '长任务里没有出现指定动作' },
      { type: 'sequence-order', say: '诊断/开发任务没先查外部就动手' },
      { type: 'requires', say: '做了 X 就必须有 Y' },
      { type: 'duration', say: '单次调用阻塞超过阈值' },
      { type: 'metric', say: '指标超过阈值' },
      { type: 'regex', say: '命令或内容里出现指定模式' },
    ]

    const defaultBind = (type) => {
      switch (type) {
        case 'path-boundary': return { type, pattern: '', requireApproval: true }
        case 'field-presence': return { type, ext: '.md', fields: [] }
        case 'explain-first': return { type }
        case 'count-threshold': return { type, consecutiveFailures: 2 }
        case 'turn-condition': return { type, ifTurnCallMin: null, thenPattern: '' }
        case 'sequence-order': return { type, taskPattern: '', first: ['web_search', 'web_fetch'], then: ['read', 'grep', 'glob'], minSamples: 10 }
        case 'requires': return { type, ifContentPattern: '', minSamples: 1 }
        case 'duration': return { type, minMinutes: 10 }
        case 'metric': return { type, key: 'context_ratio', op: '<=', threshold: 0.4 }
        default: return { type: 'regex', sources: ['commands'], pattern: '' }
      }
    }

    function ParamFields({ bind, setBind, input }) {
      const setP = (k, v) => setBind({ ...(bind || {}), [k]: v })
      const row = (label, node, help) => h('label', { style: { display: 'block', marginTop: 8 } },
        h('span', { style: { fontSize: 11, color: C.muted } }, label),
        h('div', { style: { marginTop: 3 } }, node),
        help ? h('span', { style: { fontSize: 10, color: C.muted } }, help) : null)
      if (!bind) return null
      switch (bind.type) {
        case 'explain-first':
          return h('div', { style: { fontSize: 11, color: C.muted, marginTop: 8 } }, '无需参数：检查每轮第一次调用工具前是否有解释文本')
        case 'path-boundary':
          return h('div', null,
            row('匹配的命令模式（正则）', h('input', { value: bind.pattern || '', onChange: (e) => setP('pattern', e.target.value), style: input })),
            row('豁免路径（逗号分隔，可空）', h('input', { value: (bind.exemptPaths || []).join(','), onChange: (e) => setP('exemptPaths', e.target.value.split(',').map((x) => x.trim()).filter(Boolean)), style: input })))
        case 'field-presence':
          return row('必须出现的字段（逗号分隔）', h('input', { value: (bind.fields || []).join(','), onChange: (e) => setP('fields', e.target.value.split(',').map((x) => x.trim()).filter(Boolean)), style: input }))
        case 'count-threshold':
          return row('连续失败几次算违规', h('input', { type: 'number', value: bind.consecutiveFailures ?? 2, onChange: (e) => setP('consecutiveFailures', Number(e.target.value)), style: input }))
        case 'turn-condition':
          return h('div', null,
            row('单轮调用超过几次算长任务', h('input', { type: 'number', value: bind.ifTurnCallMin ?? 12, onChange: (e) => setP('ifTurnCallMin', Number(e.target.value)), style: input })),
            row('必须出现的动作（正则）', h('input', { value: bind.thenPattern || '', onChange: (e) => setP('thenPattern', e.target.value), style: input })))
        case 'sequence-order':
          return h('div', null,
            row('什么算“该先检索”的任务（正则）', h('input', { value: bind.taskPattern || '', onChange: (e) => setP('taskPattern', e.target.value), style: input })),
            row('至少多少次任务才判定', h('input', { type: 'number', value: bind.minSamples ?? 10, onChange: (e) => setP('minSamples', Number(e.target.value)), style: input })))
        case 'requires':
          return row('触发条件（正则）', h('input', { value: bind.ifPathPattern || bind.ifContentPattern || '', onChange: (e) => setP('ifContentPattern', e.target.value), style: input }))
        case 'duration':
          return row('超过多少分钟算阻塞', h('input', { type: 'number', value: bind.minMinutes ?? 10, onChange: (e) => setP('minMinutes', Number(e.target.value)), style: input }))
        case 'metric':
          return row('阈值（0-1，例如 0.4 = 40%）', h('input', { type: 'number', step: '0.05', value: bind.threshold ?? 0.4, onChange: (e) => setP('threshold', Number(e.target.value)), style: input }))
        default:
          return h('div', null,
            row('匹配模式（正则）', h('input', { value: bind.pattern || '', onChange: (e) => setP('pattern', e.target.value), style: input })),
            row('匹配范围', h('select', { value: (bind.sources || ['commands'])[0], onChange: (e) => setP('sources', [e.target.value]), style: input },
              h('option', { value: 'commands' }, '命令'), h('option', { value: 'fileWrites' }, '写入的内容'))))
      }
    }

    function AddCard({ onDone, preds, tier }) {
      const [open, setOpen] = React.useState(false)
      const [text, setText] = React.useState('')
      const [name, setName] = React.useState('')
      const [bind, setBind] = React.useState(null)
      const [by, setBy] = React.useState('')
      const [msg, setMsg] = React.useState('')
      const [loading, setLoading] = React.useState(false)
      const [ask, setAsk] = React.useState(null)
      const [adv, setAdv] = React.useState(false)
      const [alts, setAlts] = React.useState([])
      const [extra, setExtra] = React.useState([])
      const [custom, setCustom] = React.useState('')

      React.useEffect(() => {
        if (!text.trim()) { setBind(null); setBy(''); return }
        const t = setTimeout(async () => {
          setLoading(true)
          try {
            const r = await call('api/dsh-ruleset/parse', { text })
            if (r.ok) {
              setBind(r.value.bind || defaultBind('regex'))
              setBy(r.value.by || '')
              setAsk(r.value.question || (r.value.missing?.length ? `需要补充：${r.value.missing.join(', ')}` : null))
              setAlts(r.value.alternatives || [])
              setMsg('')
            }
          } catch { /* 忽略 */ } finally { setLoading(false) }
        }, 350)
        return () => clearTimeout(t)
      }, [text])

      const setP = (k, v) => setBind({ ...(bind || {}), [k]: v })
      const input = { width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '4px 8px', borderRadius: 6, border: `1px solid ${C.line}`, background: 'transparent', color: 'inherit' }
      const row = (label, node, help) => h('label', { style: { display: 'block', marginTop: 8 } },
        h('span', { style: { fontSize: 11, color: C.muted } }, label),
        h('div', { style: { marginTop: 3 } }, node),
        help ? h('span', { style: { fontSize: 10, color: C.muted } }, help) : null)

      const sig = (b) => JSON.stringify(b, Object.keys(b || {}).sort())
      const pushBind = (b) => {
        if (!b || !b.type) return
        setExtra((list) => {
          const all = [bind, ...list].filter((x) => x && x.type).map(sig)
          if (all.includes(sig(b))) return list
          return [...list, b]
        })
      }

      const paramFields = () => h(ParamFields, { bind, setBind, input })
      const currentBinds = () => {
        const seen = new Set()
        return [bind, ...extra].filter((b) => {
          if (!b || !b.type) return false
          const k = JSON.stringify(b, Object.keys(b).sort())
          if (seen.has(k)) return false
          seen.add(k)
          return true
        })
      }
      const list0 = () => currentBinds().length

      const save = async (asPromptOnly) => {
        if (!text.trim()) return setMsg('先用一句话描述规则')
        const id = `rule-${Date.now().toString(36)}`
        const list = asPromptOnly ? [] : currentBinds()
        const r = await call('api/dsh-ruleset/add-rule', {
          id, title: name || text.slice(0, 30), text: text.slice(0, 200), binds: list, tier,
        })
        if (r.ok) {
          setOpen(false); setText(''); setBind(null); setExtra([]); setName(''); setAsk(null); setMsg('')
          onDone()
        } else setMsg(r.error?.message || '保存失败')
      }

      if (!open) {
        return h('div', {
          onClick: () => setOpen(true),
          style: { border: `1px dashed ${C.line}`, borderRadius: RAD.card, minHeight: 96, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 4, cursor: 'pointer', color: C.muted, transition: 'background .12s' },
        }, h('div', { style: { fontSize: 22, lineHeight: 1 } }, '+'), h('div', { style: { fontSize: 11 } }, '加规则'))
      }

      return h('div', { style: { border: `1px solid ${C.line}`, borderRadius: 10, background: C.surface, padding: 12, gridColumn: '1 / -1' } },
        h('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 6 } }, '用一句话描述这条规则'),
        h('textarea', {
          value: text, onChange: (e) => setText(e.target.value), rows: 2,
          placeholder: '例：在工作区外删除文件必须先问我；导出报告必须带 type 字段；上下文超过 50% 要提醒我',
          style: { ...input, resize: 'vertical', padding: 8 },
        }),
        loading ? h('div', { style: { fontSize: 11, color: C.muted, marginTop: 6 } }, '正在理解这句话…') : null,
        ask && !alts.length ? h('div', { style: { fontSize: 11, color: C.violation, marginTop: 6 } }, `需要你确认：${ask}`) : null,
        bind ? h('div', { style: { marginTop: 8, borderTop: `1px solid ${C.line}`, paddingTop: 8 } },
          h('div', { style: { fontSize: T.micro, letterSpacing: '0.05em', textTransform: 'uppercase', color: C.muted } }, '模型选择的判定方式'),
          h('div', { style: { fontSize: 10, color: C.muted, marginTop: 2 } }, by === 'llm' ? '由模型理解原句后选择' : '模型不可用，规则匹配兜底'),
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 6 } },
            h('div', { style: { fontSize: T.body, fontWeight: 600, color: C.accent, textShadow: glow(C.accent) } }, bind.type),
            h('div', { style: { fontSize: T.label, color: C.muted } },
              ((preds && preds.length ? preds : FALLBACK_TYPES).find((t) => t.type === bind.type) || {}).say || '')),
          h('button', {
            onClick: () => setAdv(!adv),
            style: { marginTop: 6, fontSize: 10, padding: '2px 8px', borderRadius: 6, border: `1px solid ${C.line}`, background: 'transparent', color: C.muted, cursor: 'pointer' },
          }, adv ? '收起手动指定' : '高级：手动指定判定方式'),
          adv ? h('select', { value: bind.type, onChange: (e) => setBind(defaultBind(e.target.value)), style: { ...input, marginTop: 6 } },
            (preds && preds.length ? preds : FALLBACK_TYPES).map((t) => h('option', { key: t.type, value: t.type }, `${t.type} —— ${t.say}`))) : null,
          paramFields(),
          row('规则名（显示在卡片上，可中文）', h('input', { value: name, onChange: (e) => setName(e.target.value), placeholder: text.slice(0, 20), style: input }))) : null,
        (alts.length || (!bind && text.trim())) ? h('div', { style: { marginTop: 10, borderTop: `1px solid ${C.line}`, paddingTop: 8 } },
          h('div', { style: { fontSize: T.label, color: C.muted, marginBottom: 6 } },
            alts.length ? '模型建议这样拆成可检查的规则：' : '模型没给出可检查判据，这里有几条常见拆法（点一下采用）：'),
          (alts.length ? alts : DEFAULT_ALTS).map((a, i) => h('div', { key: i, style: { display: 'flex', alignItems: 'baseline', gap: 8, padding: '5px 0' } },
            h('button', { onClick: () => { setBind(a.bind) }, title: '设为主判据（会替换当前选中的判定方式）', style: { fontSize: 11, padding: '2px 10px', borderRadius: 999, border: `1px solid ${C.accent}66`, background: 'transparent', color: C.accent, cursor: 'pointer' } }, `设为主判据 · ${a.type}`),
            h('span', { style: { fontSize: T.label, color: C.text } }, a.say || ''),
            h('button', { onClick: () => pushBind(a.bind), style: { fontSize: 10, padding: '1px 7px', borderRadius: 999, border: `1px solid ${C.line}`, background: 'transparent', color: C.muted, cursor: 'pointer' } }, '+ 追加'))),
          h('div', { style: { marginTop: 8 } },
            h('div', { style: { fontSize: T.label, color: C.muted } }, '其他：自己描述要检查什么'),
            h('input', { value: custom, onChange: (e) => setCustom(e.target.value), placeholder: '例：记录里必须出现 sources 和 retrieved_at 字段', style: { ...input, marginTop: 3 } }),
            h('button', {
              onClick: async () => {
                if (!custom.trim()) return
                const r = await call('api/dsh-ruleset/parse', { text: custom })
                if (r.ok && r.value.bind) pushBind(r.value.bind)
                else setMsg('这句没解析出判据，换个说法或点上面的类型')
              },
              style: { marginTop: 6, fontSize: 11, padding: '3px 10px', borderRadius: 6, border: `1px solid ${C.line}`, background: 'transparent', color: 'inherit', cursor: 'pointer' },
            }, '解析并追加'))) : null,
        false ? h('div', null,
          h('div', { style: { fontSize: T.label, color: C.muted, marginBottom: 6 } }, '模型建议这样拆成可检查的规则：'),
          [].map((a, i) => h('div', { key: i, style: { display: 'flex', alignItems: 'baseline', gap: 8, padding: '5px 0' } },
            h('button', {
              onClick: () => { setBind(a.bind); setAdv(false); setExtra((x) => [...x, a.bind]) },
              style: { fontSize: 11, padding: '2px 10px', borderRadius: 999, border: `1px solid ${C.accent}66`, background: 'transparent', color: C.accent, cursor: 'pointer' },
            }, a.type),
            h('span', { style: { fontSize: T.label, color: C.text } }, a.say || ''),
            h('button', { onClick: () => pushBind(a.bind), style: { fontSize: 10, padding: '1px 7px', borderRadius: 999, border: `1px solid ${C.line}`, background: 'transparent', color: C.muted, cursor: 'pointer' } }, '+ 追加'),
            a.why ? h('span', { style: { fontSize: 10, color: C.muted } }, a.why) : null))) : null,
        list0() ? h('div', { style: { marginTop: 8, fontSize: 11, color: C.muted } },
          `将保存 ${list0()} 个判据：`, currentBinds().map((b, i) => h('span', { key: i, style: { marginRight: 8, color: C.accent } }, b.type))) : null,
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 } },
          h('button', { onClick: () => save(false), style: { fontSize: 12, padding: '4px 12px' }, disabled: loading }, list0(0) ? `保存（${list0(0)} 个判据）` : '保存'),
          h('button', { onClick: () => save(true), style: { fontSize: 11, padding: '4px 10px', borderRadius: 6, border: `1px dashed ${C.line}`, background: 'transparent', color: C.muted, cursor: 'pointer' } }, '仅作提示（不判定）'),
          h('button', { onClick: () => { setOpen(false); setText(''); setBind(null); setName('') }, style: { fontSize: 12, padding: '4px 12px' } }, '取消'),
          h('span', { style: { fontSize: 11, color: msg ? C.violation : C.muted } }, msg || '保存前自动备份 policy.yaml')),
      )
    }

    function EditCard({ row, preds, onDone, onCancel }) {
      const [title, setTitle] = React.useState(row.title || '')
      const [text, setText] = React.useState(row.text || row.title || '')
      const initialBinds = (Array.isArray(row.binds) && row.binds.length ? row.binds : (row.bind ? [row.bind] : []))
      const [bindList, setBindList] = React.useState(initialBinds.length ? initialBinds : [defaultBind(row.predicate || 'regex')])
      const bind = bindList[0]
      const setBind = (b) => setBindList((l) => [b, ...l.slice(1)])
      const [msg, setMsg] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [adv, setAdv] = React.useState(false)
      const [hint, setHint] = React.useState('')
      const [sugg, setSugg] = React.useState([])
      const [intro, setIntro] = React.useState(null)
      const [introBusy, setIntroBusy] = React.useState(false)
      const [ask2, setAsk2] = React.useState('')

      React.useEffect(() => {
        if (!text || text.length < 6) { setSugg([]); return }
        const t = setTimeout(async () => {
          try {
            const r = await call('api/dsh-ruleset/parse', { text })
            if (r.ok) { setSugg(r.value.alternatives || []); setAsk2(r.value.question || '') }
          } catch { /* ignore */ }
        }, 500)
        return () => clearTimeout(t)
      }, [text])
      const input = { width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '4px 8px', borderRadius: 6, border: `1px solid ${C.line}`, background: 'transparent', color: 'inherit' }

      const save = async () => {
        setBusy(true); setMsg('')
        try {
          const r = await call('api/dsh-ruleset/update-rule', { id: row.id, title, text, binds: bindList })
          if (r.ok) onDone(); else setMsg(r.error?.message || '保存失败')
        } catch (e) { setMsg(String(e)) } finally { setBusy(false) }
      }

      return h('div', { style: { border: `1px solid ${C.line}`, borderRadius: 10, background: C.surface, padding: 12, marginBottom: 12, gridColumn: '1 / -1' } },
        h('div', { style: { fontSize: 12, fontWeight: 600, marginBottom: 6 } }, `编辑规则 · ${row.id}`),
        h('label', { style: { display: 'block' } }, h('span', { style: { fontSize: 11, color: C.muted } }, '规则名'),
          h('input', { value: title, onChange: (e) => setTitle(e.target.value), style: { ...input, marginTop: 3 } })),
        h('label', { style: { display: 'block', marginTop: 8 } }, h('span', { style: { fontSize: 11, color: C.muted } }, '规则正文（会注入到提示词）'),
          h('textarea', { value: text, onChange: (e) => setText(e.target.value), rows: 3, style: { ...input, marginTop: 3, resize: 'vertical', padding: 8 } })),
        h('div', { style: { marginTop: 10 } },
          h('div', { style: { fontSize: T.micro, letterSpacing: '0.05em', textTransform: 'uppercase', color: C.muted } }, '判定方式'),
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 } },
            h('div', { style: { fontSize: T.base, fontWeight: 600, color: C.accent, textShadow: glow(C.accent) } }, bind?.type || '未设置'),
            h('div', { style: { fontSize: T.label, color: C.muted } },
              ((preds && preds.length ? preds : FALLBACK_TYPES).find((t) => t.type === bind?.type) || {}).say || '当前没有机械判据')),
          h('button', {
            onClick: () => setAdv(!adv),
            style: { marginTop: 6, fontSize: 10, padding: '2px 8px', borderRadius: 6, border: `1px solid ${C.line}`, background: 'transparent', color: C.muted, cursor: 'pointer' },
          }, adv ? '收起手动指定' : '高级：手动指定判定方式'),
          adv ? h('select', { value: bind?.type || 'regex', onChange: (e) => setBind(defaultBind(e.target.value)), style: { ...input, marginTop: 6 } },
            (preds && preds.length ? preds : FALLBACK_TYPES).map((t) => h('option', { key: t.type, value: t.type }, `${t.type} —— ${t.say}`))) : null,
          (sugg.length || ask2) ? h('div', { style: { marginTop: 10, borderTop: `1px solid ${C.line}`, paddingTop: 8 } },
            h('div', { style: { fontSize: T.label, color: C.muted, marginBottom: 6 } },
              sugg.length ? '按当前正文，模型建议这样判：' : '模型建议：'),
            ask2 && !sugg.length ? h('div', { style: { fontSize: T.label, color: C.violation } }, ask2) : null,
            sugg.map((a, i) => h('div', { key: i, style: { display: 'flex', alignItems: 'baseline', gap: 8, padding: '4px 0' } },
              h('button', { onClick: () => setBindList([a.bind]), title: '替换全部判据', style: { fontSize: 10, padding: '1px 8px', borderRadius: 999, border: `1px solid ${C.accent}66`, background: 'transparent', color: C.accent, cursor: 'pointer' } }, `设为唯一判据 · ${a.type}`),
              h('button', { onClick: () => setBindList((l) => [...l, a.bind]), title: '并联追加', style: { fontSize: 10, padding: '1px 8px', borderRadius: 999, border: `1px solid ${C.line}`, background: 'transparent', color: C.muted, cursor: 'pointer' } }, '+ 并联'),
              h('span', { style: { fontSize: T.label, color: C.text } }, a.say || '')))) : null,
          h('div', { style: { marginTop: 8 } },
            h('button', {
              onClick: async () => {
                setIntroBusy(true)
                try { const r = await call('api/dsh-ruleset/introspect', { id: row.id }); if (r.ok) setIntro((r.value.items || [])[0]) } catch { /* ignore */ } finally { setIntroBusy(false) }
              },
              style: { fontSize: 11, padding: '3px 10px', borderRadius: 6, border: `1px solid ${C.line}`, background: 'transparent', color: 'inherit', cursor: 'pointer' },
            }, introBusy ? '理解中…' : '让模型理解这条规则'),
            intro ? h('div', { style: { marginTop: 6, fontSize: 11, color: C.muted, lineHeight: 1.7 } },
              intro.error ? `失败：${intro.error}` : h('div', null,
                h('div', null, `对象：${intro.object}`),
                h('div', null, `触发：${intro.trigger}`),
                h('div', null, `期望：${intro.expectation}`),
                h('div', null, `例外：${intro.exceptions || '（无）'}`),
                h('div', null, `可机械化：${intro.mechanical ? '是' : '否'}${intro.bind ? `（建议 ${intro.bind.type}）` : ''}`),
                intro.bind ? h('button', { onClick: () => setBindList([intro.bind]), style: { fontSize: 10, padding: '1px 8px', borderRadius: 999, border: `1px solid ${C.accent}66`, background: 'transparent', color: C.accent, cursor: 'pointer', marginTop: 4 } }, '采用建议判据') : null)) : null),
          h('div', { style: { marginTop: 8 } },
            h('span', { style: { fontSize: T.label, color: C.muted } }, '不满意？用一句话改：'),
            h('input', { value: hint, onChange: (e) => setHint(e.target.value), placeholder: '例：改成检查命令里出现 rm -rf', style: { ...input, marginTop: 3 } }),
            h('button', {
              onClick: async () => {
                if (!hint.trim()) return
                const r = await call('api/dsh-ruleset/parse', { text: hint })
                if (r.ok) { setBind(r.value.bind || bind); setMsg(r.value.explain || '已按模型理解更新') } else setMsg('解析失败')
              },
              style: { marginTop: 6, fontSize: 11, padding: '3px 10px', borderRadius: 6, border: `1px solid ${C.line}`, background: 'transparent', color: 'inherit', cursor: 'pointer' },
            }, '按这句话重判'))),
        bindList.map((b, i) => h('div', { key: i, style: { marginTop: 10, paddingTop: 8, borderTop: `1px dashed ${C.line}` } },
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
            h('span', { style: { fontSize: T.body, fontWeight: 600, color: C.accent } }, `${i === 0 ? '主判据' : `并联 ${i}`} · ${b.type}`),
            bindList.length > 1 ? h('button', {
              onClick: () => setBindList((l) => l.filter((_, j) => j !== i)),
              style: { marginLeft: 'auto', fontSize: 10, padding: '1px 8px', borderRadius: 6, border: `1px solid ${C.line}`, background: 'transparent', color: C.muted, cursor: 'pointer' },
            }, '移除') : null),
          h(ParamFields, { bind: b, setBind: (nb) => setBindList((l) => l.map((x, j) => (j === i ? nb : x))), input }))),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', marginTop: 10 } },
          h('button', { onClick: save, disabled: busy, style: { fontSize: 12, padding: '4px 12px' } }, busy ? '…' : '保存修改'),
          h('button', { onClick: onCancel, style: { fontSize: 12, padding: '4px 12px' } }, '取消'),
          h('span', { style: { fontSize: 11, color: msg ? C.violation : C.muted } }, msg || '保存前自动备份 policy.yaml')),
      )
    }

    function PanelIcon({ size = 16 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': true },
        h('rect', { x: 2, y: 2, width: 12, height: 12, rx: 2, fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }),
        h('path', { d: 'M4.5 8.2l2 2 5-4.4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }))
    }

    function Panel() {
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [open, setOpen] = React.useState({})
      const [preds, setPreds] = React.useState(FALLBACK_TYPES)
      const [pending, setPending] = React.useState('')
      const [bucket, setBucket] = React.useState('hour')
      const [judge, setJudge] = React.useState(null)
      const [sugg, setSugg] = React.useState(null)
      const [hyg, setHyg] = React.useState(null)
      const [showGuard, setShowGuard] = React.useState(false)
      const [showBackups, setShowBackups] = React.useState(false)
      const [backups, setBackups] = React.useState([])
      const [base, setBase] = React.useState(null)
      const [judging, setJudging] = React.useState(false)
      const [rangeH, setRangeH] = React.useState(168)
      const [editing, setEditing] = React.useState(null)

      const load = React.useCallback(async () => {
        setBusy('load'); setErr('')
        try {
          const r = await call('api/dsh-ruleset/report', { window_hours: rangeH })
          if (r.ok) setData(r.value); else setErr(r.error?.message || '读取失败')
        } catch (e) { setErr(String(e)) } finally { setBusy('') }
      }, [])

      const audit = async (hours) => {
        const h = hours || rangeH
        setBusy('audit'); setErr('')
        try {
          // 走 report 路由的强制刷新，避开 audit 路由在 dsh-app:// 下的 404
          const r = await call('api/dsh-ruleset/report', { window_hours: h, refresh: true })
          if (r.ok) setData(r.value); else setErr(r.error?.message || '审计失败')
        } catch (e) { setErr(String(e)) } finally { setBusy('') }
      }

      React.useEffect(() => { audit() }, [])
      React.useEffect(() => {
        call('api/dsh-ruleset/predicates').then((r) => { if (r.ok) setPreds(r.value) }).catch(() => {})
        call('api/dsh-ruleset/baseline', { action: 'get' }).then((r) => { if (r.ok) setBase(r.value) }).catch(() => {})
      }, [])

      const s = data?.summary || { pass: 0, violation: 0, warn: 0, stat: 0, unknown: 0 }
      const rows = data?.rows || []
      const series = (bucket === 'week' ? data?.trendWeek : bucket === 'day' ? data?.trendDay : data?.trend) || data?.series || []
      const triage = async (key, status) => {
        const res = await call('api/dsh-ruleset/finding-status', { key, status })
        if (!res.ok) { setErr(res.error?.message || '标记失败'); return }
        setData((d) => {
          if (!d) return d
          const findings = (d.findings || []).map((f) => (f.key === key ? { ...f, status } : f))
          const marked = (d.findings || []).find((f) => f.key === key)
          const summary = { ...(d.findingSummary || {}) }
          summary.open = Math.max(0, (summary.open || 0) - 1)
          summary[status] = (summary[status] || 0) + 1
          const rows = (d.rows || []).map((r) => {
            if (!marked || r.id !== marked.ruleId) return r
            const hits = Math.max(0, (r.hits || 0) - 1)
            return { ...r, hits, rate: r.base ? hits / r.base : null, status: hits === 0 ? 'pass' : r.status }
          })
          return { ...d, findings, rows, findingSummary: summary }
        })
      }

      const removeRow = async (row) => {
        if (pending !== row.id) { setPending(row.id); setTimeout(() => setPending((cur) => (cur === row.id ? '' : cur)), 4000); return }
        setPending('')
        const res = await call('api/dsh-ruleset/remove-rule', { id: row.id })
        if (res.ok) { await audit() } else { setErr(res.error?.message || '删除失败') }
      }

      const btn = (label, onClick, key, primary) => h('button', {
        onClick, disabled: Boolean(busy),
        style: {
          fontSize: T.body, fontWeight: 500, padding: '5px 12px', borderRadius: RAD.ctrl,
          border: `1px solid ${primary ? 'transparent' : C.line}`,
          background: primary ? C.accent : 'transparent',
          color: primary ? C.canvas : 'inherit',
          cursor: busy ? 'default' : 'pointer', opacity: busy && busy !== key ? 0.5 : 1,
          transition: 'background .12s, opacity .12s',
        },
      }, busy === key ? '…' : label)

      return h('div', { style: {
        padding: '16px 18px 28px', fontSize: 13, height: '100%', overflow: 'auto',
        background: C.canvas, color: C.text, boxSizing: 'border-box',
      } },
        h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 16 } },
          h('div', null,
            h('div', { style: { fontSize: T.head, fontWeight: 600, letterSpacing: '-0.01em' } }, 'Ruleset'),
            h('div', { style: { fontSize: T.micro, color: C.muted, marginTop: 2 } },
              (data?.source ? `规则源 ${data.source.kind}${data.source.draft ? '（草稿）' : ''}` : '规则合规观测') + ' · ' + BUILD)),
          h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' } },
            h('div', { style: { display: 'flex', gap: 2, marginRight: 6 } },
              [[24, '近1天'], [168, '近7天'], [720, '近30天']].map(([hv, label]) => h('button', {
                key: hv, onClick: () => { setRangeH(hv); audit(hv) },
                style: {
                  fontSize: 10, padding: '3px 9px', borderRadius: 999, cursor: 'pointer',
                  border: `1px solid ${rangeH === hv ? C.accent + '55' : C.line}`,
                  background: rangeH === hv ? `${C.accent}12` : 'transparent',
                  color: rangeH === hv ? C.accent : C.muted,
                },
              }, label))),
            h('button', {
              onClick: async () => {
                setJudging(true); setErr('')
                try {
                  const r = await call('api/dsh-ruleset/judge', { window_hours: rangeH })
                  if (r.ok) { setJudge(r.value) } else { setErr(r.error?.message || '模型复核失败') }
                } catch (e) { setErr(String(e)) } finally { setJudging(false) }
              },
              disabled: judging,
              title: '只复核没有机械判据的规则',
              style: { fontSize: 10, padding: '3px 9px', borderRadius: 999, border: `1px solid ${C.line}`, background: 'transparent', color: C.muted, cursor: 'pointer' },
            }, judging ? '复核中…' : '模型复核'),
            h('button', {
              onClick: async () => {
                try {
                  const [r, h] = await Promise.all([call('api/dsh-ruleset/suggest'), call('api/dsh-ruleset/hygiene')])
                  if (r.ok) setSugg(r.value.items)
                  if (h.ok) setHyg(h.value)
                } catch { /* ignore */ }
              },
              title: '检查哪些规则还没有机械判据，并给出建议',
              style: { fontSize: 10, padding: '3px 9px', borderRadius: 999, border: `1px solid ${C.line}`, background: 'transparent', color: C.muted, cursor: 'pointer' },
            }, '规则体检'),
            h('button', {
              onClick: async () => {
                try {
                  const r = await call('api/dsh-ruleset/baseline', { window_hours: rangeH })
                  if (r.ok) { setErr(''); call('api/dsh-ruleset/baseline', { action: 'get' }).then((x) => { if (x.ok) setBase(x.value) }); audit(rangeH) } else setErr('建基线失败')
                } catch (e) { setErr(String(e)) }
              },
              title: '把当前结果记为基线；之后差异不显著的不再飘红',
              style: { fontSize: 10, padding: '3px 9px', borderRadius: 999, border: `1px solid ${C.line}`, background: 'transparent', color: C.muted, cursor: 'pointer' },
            }, '设基线'),
            h('button', {
              onClick: async () => {
                const r = await call('api/dsh-ruleset/backups')
                if (r.ok) { setBackups(r.value.items || []); setShowBackups(!showBackups) }
              },
              title: '查看 policy 备份、回滚或导出以保留规则',
              style: { fontSize: 10, padding: '3px 9px', borderRadius: 999, border: `1px solid ${C.line}`, background: 'transparent', color: C.muted, cursor: 'pointer' },
            }, '备份与回滚'),
            btn('重新审计', () => audit(rangeH), 'audit'), btn('刷新', load, 'load'))),

        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 12 } },
          [['通过', s.pass, C.pass], ['违规', s.violation, C.violation], ['待查', s.warn || 0, C.warn], ['统计', s.stat || 0, C.stat], ['未知', s.unknown, C.unknown]].map(([label, val, color]) =>
            h('div', { key: label, style: { border: `1px solid ${C.line}`, borderRadius: RAD.card, padding: '12px 14px', background: C.surface } },
              h('div', { style: { fontSize: T.micro, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.muted, fontWeight: 500 } }, label),
              h('div', { style: { display: 'flex', alignItems: 'flex-end', gap: 8, marginTop: 6 } },
                h('div', { style: { fontSize: T.kpi, fontWeight: 600, color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' } }, String(val)),
                h('div', { style: { marginLeft: 'auto', opacity: 0.7 } },
                  series.length > 1 ? h(Spark, { values: series.map((x) => x.summary?.[label === '通过' ? 'pass' : label === '违规' ? 'violation' : 'unknown'] ?? 0), color, w: 56, hgt: 18 }) : null))))),

        h('div', { style: { border: `1px solid ${C.line}`, borderRadius: RAD.card, padding: '12px 14px', background: C.surface, marginBottom: 14 } },
          h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 } },
            h('span', { style: { fontSize: T.micro, letterSpacing: '0.06em', textTransform: 'uppercase', color: C.muted, fontWeight: 500 } }, '违规趋势'),
            h('span', { style: { display: 'flex', gap: 4, alignItems: 'center' } },
              ['hour', 'day', 'week'].map((k) => h('button', {
                key: k, onClick: () => setBucket(k),
                style: {
                  fontSize: 10, padding: '2px 8px', borderRadius: 999, cursor: 'pointer',
                  border: `1px solid ${bucket === k ? C.accent + '55' : C.line}`,
                  background: bucket === k ? `${C.accent}12` : 'transparent',
                  color: bucket === k ? C.accent : C.muted,
                },
              }, k === 'hour' ? '小时' : k === 'day' ? '天' : '周')),
              h('span', { style: { marginLeft: 4, color: C.muted } },
                series.length > 1 ? `${series.length} 个点` : '再审计一次就能画线'))),
          series.length > 1 ? h(TrendChart, { series, color: C.violation })
            : h('div', { style: { height: 64, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: C.muted } }, '暂无趋势数据（需要至少 2 次审计）')),

        showBackups ? h('div', { style: { border: `1px solid ${C.line}`, borderRadius: RAD.card, padding: 10, marginBottom: 10, background: 'rgba(255,255,255,0.5)' } },
          h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 } },
            h('strong', { style: { fontSize: 12 } }, 'policy 备份'),
            h('span', { style: { fontSize: 10, color: C.muted } }, `${backups.length} 份 · 每次写规则前自动留档`),
            h('div', { style: { marginLeft: 'auto', display: 'flex', gap: 6 } },
              h('button', {
                onClick: async () => { const r = await call('api/dsh-ruleset/backup', { action: 'manual' }); if (r.ok) { const b = await call('api/dsh-ruleset/backups'); if (b.ok) setBackups(b.value.items || []) } },
                style: { fontSize: 10, padding: '2px 8px', borderRadius: 6, border: `1px solid ${C.line}`, background: 'transparent', color: 'inherit', cursor: 'pointer' },
              }, '立即备份'),
              h('button', {
                onClick: async () => { const r = await call('api/dsh-ruleset/export'); if (r.ok) setErr(`已导出到 ${r.value.dir}`) },
                style: { fontSize: 10, padding: '2px 8px', borderRadius: 6, border: `1px solid ${C.accent}66`, background: 'transparent', color: C.accent, cursor: 'pointer' },
              }, '导出 policy + AGENTS.md'))),
          backups.length === 0 ? h('div', { style: { fontSize: 11, color: C.muted } }, '还没有备份') :
            backups.slice(0, 8).map((b) => h('div', { key: b.file, style: { display: 'flex', alignItems: 'baseline', gap: 8, fontSize: 10.5, padding: '3px 0', borderTop: `1px dashed ${C.line}` } },
              h('span', { style: { color: C.muted } }, new Date(b.ts.replace(/-/g, ':')).toLocaleString?.() || b.ts),
              h('span', { style: { flex: 1 } }, b.action),
              h('button', {
                onClick: async () => {
                  const r = await call('api/dsh-ruleset/restore', { file: b.file })
                  if (r.ok) { setErr('已回滚到 ' + b.file); audit(rangeH) } else setErr(r.error?.message || '回滚失败')
                },
                style: { fontSize: 10, padding: '1px 8px', borderRadius: 6, border: `1px solid ${C.line}`, background: 'transparent', color: 'inherit', cursor: 'pointer' },
              }, '回滚到此')))) : null,
        err ? h('div', { style: { color: C.violation, marginBottom: 10, fontSize: 12 } }, err) : null,
        sugg && sugg.length ? h('div', { style: { border: `1px solid ${C.line}`, borderRadius: RAD.card, padding: 10, marginBottom: 10, background: 'rgba(255,255,255,0.5)' } },
          h('div', { style: { fontSize: T.label, color: C.muted, marginBottom: 6 } }, `体检：${sugg.length} 条规则没有机械判据`),
          hyg ? h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 8 } },
            [
              ['可判 / 半可判 / 不可判', `${hyg.evidence?.ok ?? '-'} / ${hyg.evidence?.weak ?? '-'} / ${hyg.evidence?.none ?? '-'}`],
              ['判据覆盖率', `${Math.round((hyg.coverage?.rate || 0) * 100)}%（红线 ${hyg.coverage?.byTier?.redline?.withBind ?? 0}/${hyg.coverage?.byTier?.redline?.total ?? 0}）`],
              ['本窗口判定率', `${Math.round((data?.summary?.judgeRate || 0) * 100)}%`],
            ].map(([label, val]) => h('div', { key: label, style: { border: `1px solid ${C.line}`, borderRadius: 8, padding: '6px 8px', background: 'rgba(255,255,255,0.6)' } },
              h('div', { style: { fontSize: 9, color: C.muted } }, label),
              h('div', { style: { fontSize: 13, fontWeight: 600 } }, val)))) : null,
          hyg ? h('div', { style: { fontSize: 10, color: C.muted, marginBottom: 6 } },
            `规则 ${hyg.total} 条 · 约 ${hyg.estimatedTokens} tokens · 重复 ${hyg.dupes.length} 组 · 冲突 ${(hyg.conflicts || []).length} 组 · 无判据 ${hyg.noBind.length} 条` +
            (hyg.cost[0] ? ` · 最长 ${hyg.cost[0].id}(${hyg.cost[0].chars} 字)` : '')) : null,
          (hyg.conflicts || []).map((c, i) => h('div', { key: 'c' + i, style: { display: 'flex', gap: 8, alignItems: 'baseline', padding: '3px 0', color: C.violation } },
            h('span', { style: { fontSize: 10, padding: '0 6px', borderRadius: 999, border: `1px solid ${C.violation}` } }, '冲突'),
            h('span', { style: { fontSize: 11 } }, `${c.a} ↔ ${c.b}`),
            h('span', { style: { fontSize: 10, color: C.muted } }, c.reason))),
          sugg.map((x) => h('div', { key: x.id, style: { display: 'flex', gap: 8, alignItems: 'baseline', padding: '3px 0' } },
            h('span', { style: { flex: '0 0 auto', fontSize: 11 } }, x.title || x.id),
            h('span', { style: { flex: 1, fontSize: 10, color: C.muted } }, x.suggestion ? `建议 ${x.suggestion.type}` : `暂无法机械化（${x.classification}）`),
            x.suggestion ? h('button', {
              onClick: async () => {
                const res = await call('api/dsh-ruleset/update-rule', { id: x.id, binds: [x.suggestion] })
                if (res.ok) { setSugg((v) => (v || []).filter((y) => y.id !== x.id)); audit() }
              },
              style: { fontSize: 10, padding: '1px 8px', borderRadius: 999, border: `1px solid ${C.accent}66`, background: 'transparent', color: C.accent, cursor: 'pointer' },
            }, '采用') : null))) : null,

        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(240px, 1fr))', gap: 12, alignItems: 'start' } },
          [['redline', '红线', C.violation], ['hard', '硬约束', C.warn], ['soft', '软规则', C.stat]].map(([tier, label, color]) => {
            const list = rows.filter((r) => (r.tier || 'hard') === tier)
            return h('section', {
              key: tier,
              onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move' },
              onDrop: async (e) => {
                e.preventDefault()
                const id = e.dataTransfer.getData('text/plain')
                if (!id) return
                const row = rows.find((r) => r.id === id)
                if (!row || (row.tier || 'hard') === tier) return
                const res = await call('api/dsh-ruleset/set-tier', { id, tier })
                if (res.ok) setData((d) => d ? { ...d, rows: d.rows.map((r) => r.id === id ? { ...r, tier } : r) } : d)
                else setErr(res.error?.message || '调整分级失败')
              },
              style: { border: `1px solid ${C.line}`, borderRadius: RAD.card, padding: 10, background: 'rgba(255,255,255,0.35)' },
            },
              h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 8 } },
                h('span', { style: { width: 8, height: 8, borderRadius: 4, background: color } }),
                h('strong', { style: { fontSize: T.body } }, label),
                h('span', { style: { fontSize: T.micro, color: C.muted } }, `${list.length} 条`)),
              h('div', { style: { display: 'grid', gap: 8 } },
                list.map((r) => h(Card, {
                  key: r.id, row: r, series, windowHours: data?.windowHours || rangeH, bucket, findings: data?.findings || [],
                  model: (judge?.results || []).find((x) => x.id === r.id) || null,
                  open: Boolean(open[r.id]), pending: pending === r.id,
                  onEdit: (row) => setEditing(row),
                  onToggle: () => setOpen((o) => ({ ...o, [r.id]: !o[r.id] })),
                  onTriage: triage,
                  onRemove: removeRow,
                })),
                h(AddCard, { key: '__add_' + tier, preds, tier, onDone: () => { audit() } })))
          })),
        h('div', { style: { marginTop: 12, fontSize: 10, color: C.muted } },
          data?.facts ? `${data.facts.sessions} 会话 · ${data.facts.turns} 轮 · ${data.facts.commands} 命令` : ''),
      )
    }

    class Boundary extends React.Component {
      constructor(props) { super(props); this.state = { err: null } }
      static getDerivedStateFromError(err) { return { err } }
      componentDidCatch(err) { try { console.error('[ruleset] panel crashed', err) } catch { /* ignore */ } }
      render() {
        if (this.state.err) {
          return h('div', { style: { padding: 16, fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#b3123f', background: '#fff', height: '100%', overflow: 'auto' } },
            h('div', { style: { fontWeight: 600, marginBottom: 8 } }, 'Ruleset 面板渲染失败'),
            h('pre', { style: { whiteSpace: 'pre-wrap' } }, String(this.state.err && (this.state.err.stack || this.state.err.message) || this.state.err)),
            h('button', { onClick: () => this.setState({ err: null }), style: { marginTop: 8 } }, '重试'))
        }
        return this.props.children
      }
    }
    const SafePanel = (props) => h(Boundary, null, h(Panel, props))

    return {
      inject: ['slots'],
      apply(ctx) {
        try { remoteCommands = ctx.remote?.commands || null } catch { /* ignore */ }
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 30, label: () => 'Ruleset' }, PanelIcon))
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, SafePanel))
      },
    }
  },
})
