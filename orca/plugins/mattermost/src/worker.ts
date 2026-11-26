import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import type { OrcaWorkerApi } from 'orca/worker'

export function request(input: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const child = spawn('python3', [fileURLToPath(new URL('../scripts/bridge.py', import.meta.url))], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PATH: [process.env.PATH || '', '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/Applications/Orca.app/Contents/Resources/bin'].join(':') } })
    let output = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error('Проверка заняла слишком долго. Обновите список перед повтором.')) }, 110000)
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 950000) child.kill() })
    child.stderr.resume() // Never expose subprocess diagnostics, argv or credentials.
    child.on('error', () => { clearTimeout(timer); reject(new Error('Python 3 недоступен')) })
    child.on('close', code => {
      clearTimeout(timer)
      try {
        const answer = JSON.parse(output)
        if (code !== 0 || !answer.ok) throw new Error(answer.error || 'Ошибка CLI')
        resolve(answer.result)
      } catch (error) { reject(error instanceof SyntaxError ? new Error('Некорректный ответ CLI') : error) }
    })
    child.stdin.on('error', () => {})
    child.stdin.end(JSON.stringify(input))
  })
}
export default function activate(orca: OrcaWorkerApi): void {
  orca.panels.handle('mattermost', input => request(input))
}
