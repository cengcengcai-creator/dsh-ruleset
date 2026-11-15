window.__ModuleLoader__.load({
  id: 'dsh-ruleset',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const call = async (p, body) => {
      const res = await fetch(p, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      })
      return res.json()
    }

    const badge = (status) => {
      const color = status === 'violation' ? '#d4380d' : status === 'pass' ? '#237804' : '#8c8c8c'
      return h('span', {
        style: { color, border: `1px solid ${color}`, borderRadius: 4, padding: '0 6px', fontSize: 11, marginRight: 8 },
      }, status)
    }

    function Panel() {
      const [data, setData] = React.useState(null)
      const [err, setErr] = React.useState('')
      const [busy, setBusy] = React.useState(false)

      const load = React.useCallback(async () => {
        setBusy(true); setErr('')
        try {
          const r = await call('/api/dsh-ruleset/report')
          if (r.ok) setData(r.value); else setErr(r.error?.message || '读取失败')
        } catch (e) { setErr(String(e)) } finally { setBusy(false) }
      }, [])

      React.useEffect(() => { load() }, [load])

      const init = async () => {
        setBusy(true); setErr('')
        try {
          const r = await call('/api/dsh-ruleset/init')
          if (!r.ok) setErr(r.error?.message || '生成失败')
          else await load()
        } catch (e) { setErr(String(e)) } finally { setBusy(false) }
      }

      const rows = (data?.rows || []).slice(0, 30)
      return h('div', { style: { padding: 12, fontSize: 12 } },
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } },
          h('strong', null, 'Ruleset'),
          h('button', { onClick: load, disabled: busy }, busy ? '…' : '刷新'),
          h('button', { onClick: init, disabled: busy }, '生成草稿'),
        ),
        err ? h('div', { style: { color: '#d4380d', marginBottom: 8 } }, err) : null,
        data ? h('div', { style: { marginBottom: 8, opacity: 0.7 } },
          `源：${data.source?.kind || '-'} · 会话 ${data.facts?.sessions ?? '-'} · 命令 ${data.facts?.commands ?? '-'}`) : null,
        rows.length === 0 ? h('div', { style: { opacity: 0.6 } }, '还没有报告：先在对话里调用 observe_report') :
          h('div', null, rows.map((r) => h('div', { key: r.id, style: { display: 'flex', alignItems: 'center', padding: '3px 0' } },
            badge(r.status),
            h('span', { style: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, r.title || r.id),
            h('span', { style: { opacity: 0.6 } }, r.base ? `${r.hits}/${r.base}` : '-'),
          ))),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: 'dsh-ruleset', order: 30, label: 'Ruleset',
        }, Panel))
      },
    }
  },
})
