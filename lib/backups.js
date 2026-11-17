/** 用户文件备份与回滚：policy.yaml 每次写入前留快照，可一键还原。 */
import fs from 'node:fs'
import path from 'node:path'

const root = () => path.join(process.env.HOME || '', '.dsh', 'workspace', '.ruleset', 'backups')
const indexFile = () => path.join(root(), 'index.json')
export const policyPath = () => path.join(process.env.HOME || '', '.dsh', 'workspace', 'policy.yaml')

function readIndex() {
  try { return JSON.parse(fs.readFileSync(indexFile(), 'utf8')) } catch { return [] }
}
function writeIndex(list) {
  try {
    fs.mkdirSync(root(), { recursive: true })
    fs.writeFileSync(indexFile(), JSON.stringify(list.slice(-50), null, 2))
  } catch { /* ignore */ }
}

export function listBackups() {
  return readIndex().slice().reverse()
}

/** 写入前调用：返回备份条目（失败不阻断写入，但要记录原因）。 */
export function backupPolicy(action = 'write') {
  try {
    const src = policyPath()
    if (!fs.existsSync(src)) return { ok: true, skipped: 'no-policy' }
    fs.mkdirSync(root(), { recursive: true })
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const name = `policy-${ts}.yaml`
    fs.copyFileSync(src, path.join(root(), name))
    const item = { ts, file: name, action, bytes: fs.statSync(src).size }
    const list = readIndex()
    list.push(item)
    writeIndex(list)
    return { ok: true, item }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) }
  }
}

export function restoreBackup(name) {
  const list = readIndex()
  const item = list.find((x) => x.file === name || x.ts === name)
  if (!item) return { ok: false, error: '没有这个备份' }
  const from = path.join(root(), item.file)
  if (!fs.existsSync(from)) return { ok: false, error: '备份文件已不存在' }
  try {
    // 回滚前再留一份，避免回滚本身不可逆
    backupPolicy('pre-restore')
    fs.copyFileSync(from, policyPath())
    return { ok: true, restored: item.file }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) }
  }
}

/** 卸载前导出：把当前 policy 与 AGENTS.md 复制到用户可保留的位置。 */
export function exportForKeep(dir) {
  try {
    const out = dir || path.join(process.env.HOME || '', '.dsh', 'workspace', '.ruleset', 'export')
    fs.mkdirSync(out, { recursive: true })
    const copied = []
    if (fs.existsSync(policyPath())) {
      fs.copyFileSync(policyPath(), path.join(out, 'policy.yaml'))
      copied.push('policy.yaml')
    }
    const agents = path.join(process.env.HOME || '', '.dsh', 'workspace', 'AGENTS.md')
    if (fs.existsSync(agents)) {
      fs.copyFileSync(agents, path.join(out, 'AGENTS.md'))
      copied.push('AGENTS.md')
    }
    return { ok: true, dir: out, copied }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) }
  }
}
