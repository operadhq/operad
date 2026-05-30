/**
 * watch.ts — Process wrapper that captures dev server output.
 *
 * Usage: operad-session watch [--name label] -- <command...>
 *
 * Wraps a child process, captures stdout/stderr to dual-format logs
 * (.raw.log with ANSI codes, .txt cleaned), and forwards signals
 * for graceful shutdown. Pure TypeScript — no Python supervisor.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream, mkdirSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { LOGS_DIR, ensureHome } from './paths.js'

// ─── Types ────────────────────────────────────────────────────────────────────

interface WatchOptions {
  command: string[]
  name?: string
}

interface RunRecord {
  command: string
  key: string
  name?: string
  startedAt: string
  rawPath: string
  textPath: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Turn ["bun", "run", "dev"] into "bun-run-dev" for filenames */
function commandToKey(cmd: string[]): string {
  return cmd.join('-').replace(/[^a-zA-Z0-9_-]/g, '_')
}

/** Clean ANSI control chars and normalize line endings */
function cleanChunk(raw: Buffer): string {
  const text = stripVTControlCharacters(raw.toString('utf-8'))
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

// ─── Core ─────────────────────────────────────────────────────────────────────

export async function watch(options: WatchOptions): Promise<void> {
  if (options.command.length === 0) {
    console.error('Error: No command provided.')
    console.error('Usage: operad-session watch [--name label] -- <command...>')
    process.exit(1)
  }

  // Ensure log directory exists
  ensureHome()
  mkdirSync(LOGS_DIR, { recursive: true })

  const key = options.name ?? commandToKey(options.command)
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const rawPath = join(LOGS_DIR, `${key}.${timestamp}.raw.log`)
  const textPath = join(LOGS_DIR, `${key}.${timestamp}.txt`)
  const latestRawPath = join(LOGS_DIR, `${key}.raw.log`)
  const latestTextPath = join(LOGS_DIR, `${key}.txt`)
  const globalLatestRaw = join(LOGS_DIR, 'latest.raw.log')
  const globalLatestText = join(LOGS_DIR, 'latest.txt')
  const runsPath = join(LOGS_DIR, 'runs.jsonl')

  // Open streams
  const rawStream = createWriteStream(rawPath)
  const textStream = createWriteStream(textPath)
  const latestRaw = createWriteStream(latestRawPath)
  const latestText = createWriteStream(latestTextPath)
  const globalRaw = createWriteStream(globalLatestRaw)
  const globalText = createWriteStream(globalLatestText)

  // Record this run
  const record: RunRecord = {
    command: options.command.join(' '),
    key,
    name: options.name,
    startedAt: new Date().toISOString(),
    rawPath,
    textPath,
  }
  appendFileSync(runsPath, JSON.stringify(record) + '\n')

  const commandStr = options.command.join(' ')
  console.log(`\x1b[2m[operad watch] ${commandStr} → ${LOGS_DIR}/${key}.*\x1b[0m`)

  // Spawn child in a new process group for tree-killing
  const child: ChildProcess = spawn(options.command[0], options.command.slice(1), {
    stdio: ['inherit', 'pipe', 'pipe'],
    detached: true,
  })

  // Capture stdout
  child.stdout?.on('data', (data: Buffer) => {
    process.stdout.write(data)            // passthrough to user
    rawStream.write(data)                 // timestamped raw
    latestRaw.write(data)                 // latest raw
    globalRaw.write(data)                 // global latest raw
    const cleaned = cleanChunk(data)
    if (cleaned) {
      textStream.write(cleaned)           // timestamped cleaned
      latestText.write(cleaned)           // latest cleaned
      globalText.write(cleaned)           // global latest cleaned
    }
  })

  // Capture stderr
  child.stderr?.on('data', (data: Buffer) => {
    process.stderr.write(data)            // passthrough to user
    rawStream.write(data)
    latestRaw.write(data)
    globalRaw.write(data)
    const cleaned = cleanChunk(data)
    if (cleaned) {
      textStream.write(cleaned)
      latestText.write(cleaned)
      globalText.write(cleaned)
    }
  })

  // Signal forwarding: send to entire process group, escalate after timeout
  let shuttingDown = false

  function closeStreams(): void {
    for (const s of [rawStream, textStream, latestRaw, latestText, globalRaw, globalText]) {
      s.end()
    }
  }

  function forwardSignalAndShutdown(signal: NodeJS.Signals): void {
    if (shuttingDown) return    // idempotent — don't double-send
    shuttingDown = true

    if (!child.pid) {
      closeStreams()
      process.exit(1)
      return
    }

    // Send signal to entire process group (negative PID)
    try { process.kill(-child.pid, signal) } catch { /* already dead */ }

    // Give graceful handlers time to clean up, then escalate
    const escalationTimer = setTimeout(() => {
      try { process.kill(-child.pid!, 'SIGKILL') } catch { /* already dead */ }
    }, signal === 'SIGINT' ? 5000 : 1000)

    // Don't let the timer keep the process alive
    escalationTimer.unref()
  }

  // Wire up signal handlers
  process.on('SIGINT', () => forwardSignalAndShutdown('SIGINT'))
  process.on('SIGTERM', () => forwardSignalAndShutdown('SIGTERM'))

  // Handle child exit
  child.on('exit', (code, signal) => {
    closeStreams()
    process.exit(code ?? (signal ? 1 : 0))
  })
}
