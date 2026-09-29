// Owns the Engine inside the sidecar: hides its lifecycle behind one status stream.

import { EventEmitter } from 'node:events'
import { Engine, loadIdentity, loadSyncDir, type DeviceInfo, type EngineStatus } from '@peerbox/core'
import type { HostStatus } from '../shared/app-state'

export class EngineHost extends EventEmitter {
  private engine: Engine | null = null
  private stopped = false

  constructor (private readonly configDir: string) {
    super()
  }

  get status (): HostStatus {
    return this.engine?.status ?? 'not-setup'
  }

  get baseKey (): string | null {
    return this.engine?.baseKey ?? null
  }

  get syncDir (): string | null {
    return this.engine?.syncDir ?? null
  }

  /** Peers currently connected and replicating. */
  get peers (): number {
    return this.engine?.peers ?? 0
  }

  /** Last engine failure, or null. */
  get error (): string | null {
    return this.engine?.error ?? null
  }

  /** Recovery phrase — null for a linked (paired) device, which has none of its own. */
  get phrase (): string | null {
    return this.engine?.phrase ?? null
  }

  listDevices (): DeviceInfo[] {
    return this.engine?.listDevices() ?? []
  }

  async revokeDevice (deviceKey: string): Promise<void> {
    if (!this.engine) throw new Error('engine not ready')
    await this.engine.revokeDevice(deviceKey)
  }

  /** Re-run failed sync work (the UI's Retry). */
  async retry (): Promise<void> {
    await this.engine?.retry()
  }

  /** Power-event hooks: the swarm can't survive a sleep. */
  async suspend (): Promise<void> {
    await this.engine?.suspend()
  }

  async resume (): Promise<void> {
    await this.engine?.resume()
  }

  async start (): Promise<void> {
    if (!loadIdentity(this.configDir)) {
      this.emit('status', 'not-setup')
      return
    }

    this.adopt(await Engine.open(loadSyncDir(this.configDir), this.configDir))
  }

  /** First-run setup: create a new drive in `syncDir` and start hosting it. */
  async create (syncDir: string): Promise<{ phrase: string }> {
    const engine = await Engine.create(syncDir, this.configDir)
    this.adopt(engine)
    if (!engine.phrase) throw new Error('newly created drive has no recovery phrase')
    return { phrase: engine.phrase }
  }

  /** Link this device: join an existing drive via its base key. */
  async pair (baseKey: string, syncDir: string): Promise<void> {
    this.adopt(await Engine.pair(syncDir, baseKey, this.configDir))
  }

  /** Rebuild the identity from a recovery phrase and rejoin the drive. */
  async restore (phrase: string, syncDir: string): Promise<void> {
    this.adopt(await Engine.restore(syncDir, phrase, this.configDir))
  }

  /** Point the same drive at a different local folder. */
  async changeFolder (syncDir: string): Promise<void> {
    await this.engine?.stop()
    this.adopt(await Engine.open(syncDir, this.configDir))
  }

  async stop (): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    await this.engine?.stop()
    this.engine = null
  }

  private adopt (engine: Engine): void {
    this.engine = engine
    engine.on('status', (status: EngineStatus) => this.emit('status', status))
    // Status already goes to 'error' and carries the message; this is the log.
    engine.on('error', (err: Error) => console.error('[peerbox] engine error:', err))
    this.emit('status', engine.status)
  }
}
