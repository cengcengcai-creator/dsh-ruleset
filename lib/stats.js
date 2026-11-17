/** 显著性判定（移植自 OpenClaw audit-verdict.py 的两比例 z 检验）。 */
import fs from 'node:fs'
import path from 'node:path'

export const Z_CRIT = 1.96

export function twoPropZ(okCur, nCur, okBase, nBase) {
  if (nCur <= 0 || nBase <= 0) return null
  const p1 = okCur / nCur
  const p2 = okBase / nBase
  const p = (okCur + okBase) / (nCur + nBase)
  const se = Math.sqrt(p * (1 - p) * (1 / nCur + 1 / nBase))
  if (!Number.isFinite(se) || se <= 0) return null
  return (p1 - p2) / se
}

const file = () => path.join(process.env.HOME || '', '.dsh', 'workspace', '.ruleset', 'baseline.json')

export function loadBaseline() {
  try { return JSON.parse(fs.readFileSync(file(), 'utf8')) } catch { return {} }
}

export function saveBaseline(map) {
  try {
    fs.mkdirSync(path.dirname(file()), { recursive: true })
    fs.writeFileSync(file(), JSON.stringify(map, null, 2))
    return true
  } catch { return false }
}

/** 用当前结果建基线（只存可判定的规则）。 */
export function buildBaseline(rows) {
  const map = {}
  for (const r of rows) {
    if (!r.base) continue
    map[r.id] = { n: r.base, ok: r.base - (r.hits || 0), at: new Date().toISOString() }
  }
  return map
}

/**
 * 与基线比较：差异不显著 → inconclusive（灰），显著变差 → 保留 violation。
 * 样本不足（<30）直接返回原状态，避免小样本误报。
 */
export function applySignificance(rows, baseline) {
  for (const r of rows) {
    const b = baseline[r.id]
    if (!b || !r.base || r.base < 30) continue
    const okCur = r.base - (r.hits || 0)
    const z = twoPropZ(okCur, r.base, b.ok, b.n)
    if (z === null) continue
    r.z = Number(z.toFixed(2))
    if (Math.abs(z) < Z_CRIT) {
      if (r.status === 'violation' || r.status === 'warn') {
        r.significance = 'inconclusive'
        r.detail = `${r.detail}（较基线差异不显著 z=${r.z}）`
      }
    } else if (z < 0) {
      r.detail = `${r.detail}（显著变差 z=${r.z}）`
    }
  }
  return rows
}
