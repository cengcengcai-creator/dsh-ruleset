/** 每日历史：每次审计写一份，面板用它画趋势。只存插件状态，不碰用户文件。 */
import fs from 'node:fs'
import path from 'node:path'

export function historyDir() {
  return path.join(process.env.HOME || '', '.dsh', 'workspace', '.ruleset', 'history')
}

const day = () => new Date().toISOString().slice(0, 10)

export function seriesPath() {
  return path.join(historyDir(), 'series.json')
}

/** 每次审计追加一条（保留最近 200 次），用于当日就能看到趋势。 */
function appendSeries(payload) {
  try {
    let series = []
    try { series = JSON.parse(fs.readFileSync(seriesPath(), 'utf8')) } catch { series = [] }
    series.push({
      at: payload.at,
      summary: payload.summary,
      rules: Object.fromEntries(payload.rows.map((r) => [r.id, { status: r.status, hits: r.hits ?? 0, base: r.base ?? 0, rate: r.rate ?? null }])),
    })
    if (series.length > 200) series = series.slice(-200)
    fs.mkdirSync(historyDir(), { recursive: true })
    fs.writeFileSync(seriesPath(), JSON.stringify(series))
  } catch { /* ignore */ }
}

/** 按时间桶聚合：同一桶只留最后一次，避免“每次打开都审计”把曲线挤爆。 */
export function seriesByTime(series, bucketMinutes = 60, maxBuckets = 24) {
  const buckets = new Map()
  for (const s of series) {
    const t = Date.parse(s.at)
    if (Number.isNaN(t)) continue
    const key = Math.floor(t / (bucketMinutes * 60000))
    buckets.set(key, s) // 后来覆盖前者 → 留桶内最后一次
  }
  const keys = [...buckets.keys()].sort((a, b) => a - b).slice(-maxBuckets)
  return keys.map((k) => buckets.get(k))
}

export function readSeries(n = 20) {
  try {
    const series = JSON.parse(fs.readFileSync(seriesPath(), 'utf8'))
    return series.slice(-n)
  } catch { return [] }
}

export function saveHistory(payload) {
  try {
    fs.mkdirSync(historyDir(), { recursive: true })
    const rules = {}
    for (const r of payload.rows) rules[r.id] = { status: r.status, hits: r.hits ?? 0, base: r.base ?? 0, rate: r.rate ?? null }
    const file = path.join(historyDir(), `${day()}.json`)
    fs.writeFileSync(file, JSON.stringify({ date: day(), at: payload.at, summary: payload.summary, rules }, null, 2))
    appendSeries(payload)
    return true
  } catch { return false }
}

export function readHistory(days = 14) {
  const out = []
  let files = []
  try { files = fs.readdirSync(historyDir()).filter((f) => f.endsWith('.json')).sort() } catch { return out }
  for (const f of files.slice(-days)) {
    try { out.push(JSON.parse(fs.readFileSync(path.join(historyDir(), f), 'utf8'))) } catch { /* 跳过坏文件 */ }
  }
  return out
}
