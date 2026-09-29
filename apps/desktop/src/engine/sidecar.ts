// Engine sidecar: newline-delimited JSON with the Tauri shell over stdin/stdout.
// Requests {id, method, params} -> {id, ok, result|error}; events {event: "status", ...}.
// stdout carries only JSON; logs go to stderr.

import { createInterface } from 'node:readline'
import { configDir, loadSyncDir } from '@peerbox/core'
import { EngineHost } from './engine-host'

const host = new EngineHost(configDir())

function send (message: unknown): void {
  try {
    process.stdout.write(JSON.stringify(message) + '\n')
  } catch (err) {
    // Parent went away; nothing left to do.
    console.error('[peerbox] stdout write failed:', err)
    process.exit(0)
  }
}

// Writes to a closed pipe also fail asynchronously as stream errors.
process.stdout.on('error', () => { void shutdown() })

// ---------------------------------------------------------------------------
// Method handlers, called by the Rust shell.

type StateResult = {
  view: 'setup'
  defaultDir: string
} | {
  view: 'status'
  status: string
  peers: number
  error: string | null
  baseKey: string
  syncDir: string
  hasPhrase: boolean
}

async function getState (): Promise<StateResult> {
  if (host.status === 'not-setup') {
    return { view: 'setup', defaultDir: loadSyncDir(configDir()) }
  }
  return {
    view: 'status',
    status: host.status,
    peers: host.peers,
    error: host.error,
    baseKey: host.baseKey ?? '',
    syncDir: host.syncDir ?? '',
    hasPhrase: host.phrase !== null
  }
}

type Handler = (params: unknown[]) => Promise<unknown> | unknown

const handlers: Record<string, Handler> = {
  getState,
  getPhrase: () => host.phrase,
  listDevices: () => host.listDevices(),
  retry: () => host.retry(),
  revokeDevice: async ([deviceKey]) => {
    if (host.phrase === null) throw new Error('not allowed on this device')
    await host.revokeDevice(String(deviceKey))
  },
  changeFolder: async ([syncDir]) => { await host.changeFolder(String(syncDir)) },
  create: async ([syncDir]) => host.create(String(syncDir)),
  pair: async ([baseKey, syncDir]) => host.pair(String(baseKey), String(syncDir)),
  restore: async ([phrase, syncDir]) => host.restore(String(phrase), String(syncDir)),
  stop: () => host.stop()
}

// ---------------------------------------------------------------------------
// Sleep/wake watchdog: a 15s timer firing much later means the machine slept,
// so rebuild the swarm (sockets don't survive a suspend).

const WATCHDOG_MS = 15_000
const SLEEP_GAP_MS = WATCHDOG_MS + 20_000

let lastTick = Date.now()
let waking = false
setInterval(() => {
  const now = Date.now()
  if (now - lastTick > SLEEP_GAP_MS && !waking) {
    waking = true
    console.error('[peerbox] system woke from sleep — re-announcing')
    void host.suspend()
      .then(() => host.resume())
      .catch((err: unknown) => console.error('[peerbox] re-announce failed:', err))
      .finally(() => { waking = false })
  }
  lastTick = now
}, WATCHDOG_MS)

// ---------------------------------------------------------------------------
// Shutdown: on a stop request or when the parent dies (stdin closes), stop cleanly.

let stopping = false
async function shutdown (): Promise<void> {
  if (stopping) return
  stopping = true
  try {
    await host.stop()
  } catch (err) {
    console.error('[peerbox] error stopping engine:', err)
  }
  process.exit(0)
}

process.stdin.on('close', () => { void shutdown() })
process.on('SIGTERM', () => { void shutdown() })
process.on('SIGINT', () => { void shutdown() })

// ---------------------------------------------------------------------------
// The request loop.

async function start (): Promise<void> {
  await host.start() // resolves instantly when no identity exists yet
  const rl = createInterface({ input: process.stdin })
  rl.on('line', (line) => {
    void (async () => {
      let id: number | null = null
      try {
        const request = JSON.parse(line) as { id: number, method: string, params?: unknown[] }
        id = request.id
        const handler = handlers[request.method]
        if (!handler) throw new Error(`unknown method: ${request.method}`)
        const result = await handler(request.params ?? [])
        send({ id, ok: true, result: result ?? null })
      } catch (err) {
        if (id !== null) {
          send({ id, ok: false, error: err instanceof Error ? err.message : String(err) })
        }
      }
    })()
  })
}

host.on('status', (status: string) => {
  send({ event: 'status', status, peers: host.peers, error: host.error })
})

void start().catch((err: unknown) => {
  console.error('[peerbox] sidecar failed to start:', err)
  process.exit(1)
})
