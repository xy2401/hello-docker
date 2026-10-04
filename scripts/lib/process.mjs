import { spawn } from 'node:child_process'

export function executeProcess(program, args, { cwd, env = {}, timeoutMs = 120_000, signal, maxBytes = 8 * 1024 * 1024 } = {}) {
  return new Promise(resolve => {
    const started = Date.now()
    let stdout = ''
    let stderr = ''
    let bytes = 0
    let error = null
    let timedOut = false
    let truncated = false
    let escalation
    const child = spawn(program, args, { cwd, env: { ...process.env, ...env }, shell: false, windowsHide: true, detached: process.platform !== 'win32' })
    const kill = force => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM')
        else child.kill(force ? 'SIGKILL' : 'SIGTERM')
      } catch { /* Process may already have exited. */ }
    }
    const stop = () => { kill(false); escalation = setTimeout(() => kill(true), 1000) }
    const aborted = () => { error = 'Execution cancelled'; stop() }
    signal?.addEventListener('abort', aborted, { once: true })
    if (signal?.aborted) aborted()
    const timer = setTimeout(() => { timedOut = true; error = 'Execution timed out'; stop() }, timeoutMs)
    const append = (stream, value) => {
      bytes += value.length
      if (bytes > maxBytes) { if (!truncated) { truncated = true; error = 'Output limit exceeded'; stop() }; return }
      if (stream === 'stdout') stdout += value.toString()
      else stderr += value.toString()
    }
    child.stdout.on('data', value => append('stdout', value))
    child.stderr.on('data', value => append('stderr', value))
    child.on('error', value => { error = value.message })
    child.on('close', (code, terminationSignal) => {
      clearTimeout(timer)
      clearTimeout(escalation)
      signal?.removeEventListener('abort', aborted)
      resolve({ stdout, stderr, exitCode: code ?? -1, signal: terminationSignal, timedOut, truncated, error, timeMs: Date.now() - started })
    })
  })
}
