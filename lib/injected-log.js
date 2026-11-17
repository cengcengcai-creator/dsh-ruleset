/** 注入可核：记录每次真正送进 system prompt 的规则内容指纹。 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const file = () => path.join(process.env.HOME || '', '.dsh', 'workspace', '.ruleset', 'injected.log')

export function recordInjected(text, meta = {}) {
  try {
    const body = String(text || '')
    const hash = crypto.createHash('sha1').update(body).digest('hex').slice(0, 10)
    const dir = path.dirname(file())
    fs.mkdirSync(dir, { recursive: true })
    let last = ''
    try { const lines = fs.readFileSync(file(), 'utf8').trim().split('\n'); last = lines[lines.length - 1] || '' } catch { /* 首次 */ }
    if (last.includes(`\t${hash}\t`)) return { hash, changed: false }
    fs.appendFileSync(file(), `${new Date().toISOString()}\t${hash}\t${body.length}\t${meta.rules || 0}\t${meta.mode || ''}\n`)
    return { hash, changed: true }
  } catch { return { hash: '', changed: false } }
}

export function readInjected(limit = 20) {
  try {
    const lines = fs.readFileSync(file(), 'utf8').trim().split('\n').filter(Boolean)
    return lines.slice(-limit).map((l) => {
      const [at, hash, chars, rules, mode] = l.split('\t')
      return { at, hash, chars: Number(chars), rules: Number(rules), mode }
    })
  } catch { return [] }
}
