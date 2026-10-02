// Sync engine: one autobase per drive, a Hyperbee view (path -> blob ref) and
// hyperblobs for file bytes, replicated over Hyperswarm. Node-only, no UI.

import { EventEmitter } from 'node:events'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { createHash, randomBytes } from 'node:crypto'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { pipelinePromise } from 'streamx'
import { watch, type FSWatcher } from 'chokidar'
import Corestore from 'corestore'
import Autobase from 'autobase'
import Hypercore from 'hypercore'
import Hyperbee from 'hyperbee'
import Hyperblobs from 'hyperblobs'
import Hyperswarm from 'hyperswarm'
import b4a from 'b4a'
import crypto from 'hypercore-crypto'
import {
  conflictedName,
  isIgnoredFile,
  normalizePath,
  numberedConflictName,
  type BlobId,
  type BlobRef,
  type DelOp,
  type PutOp
} from '@peerbox/protocol'
import {
  authorityKeyPair,
  bootstrapKeyPair,
  configDir as defaultConfigDir,
  createIdentity,
  deviceLabel,
  loadIdentity,
  pairIdentity,
  restoreIdentity,
  saveIdentity,
  signAddWriter,
  signRemoveWriter,
  type Identity,
  type KeyPair
} from './identity'

export type EngineStatus = 'idle' | 'syncing' | 'waiting' | 'error'

// Backoff for re-announcing while we expect peers but have none.
const RECONNECT_MIN_MS = 4_000
const RECONNECT_MAX_MS = 60_000

export interface DeviceInfo {
  key: string // hex writer key
  label: string // short id, see identity.ts:deviceLabel
  isLocal: boolean
}

// ---------------------------------------------------------------------------
// Deterministic apply handler (runs on every device identically)

// Debug output goes to stderr: the desktop sidecar's stdout is its JSON protocol.
function debug (msg: string): void {
  if (process.env.PEERBOX_DEBUG) console.error('[peerbox] ' + msg)
}

async function uniqueConflictPath (view: any, path: string, device: string): Promise<string> {
  let candidate = conflictedName(path, device)
  let i = 2
  while ((await view.get(candidate)) !== null) {
    candidate = numberedConflictName(path, device, i++)
  }
  return candidate
}

/** Streaming sha256 of a file on disk — O(block) memory, any file size. */
async function hashFile (absPath: string): Promise<string> {
  const hasher = createHash('sha256')
  for await (const chunk of createReadStream(absPath)) hasher.update(chunk as Buffer)
  return hasher.digest('hex')
}

function sameBlob (a: BlobRef, b: BlobRef): boolean {
  return a.device === b.device && JSON.stringify(a.id) === JSON.stringify(b.id)
}

// Same ref, or (when both carry hashes) byte-identical content — two devices
// independently adding the same file is not a conflict worth archiving.
function sameContent (a: BlobRef, b: BlobRef): boolean {
  if (sameBlob(a, b)) return true
  return a.hash !== undefined && a.hash === b.hash
}

// View values carry `seq` (writer-local op index) so a later put's `basedOn`
// can name the exact version it supersedes. Older entries lack it and always conflict.
type StoredBlob = BlobRef & { seq?: number }

// True if the writer had already seen `existing` (a sequential edit, like an
// ETag match); a stale `basedOn` means a concurrent write landed first.
function isSequentialEdit (basedOn: { device: string, seq: number } | null | undefined, existing: StoredBlob): boolean {
  if (!basedOn || typeof existing.seq !== 'number') return false
  return basedOn.device === existing.device && basedOn.seq === existing.seq
}

async function applyOps (nodes: any[], view: any, host: any): Promise<void> {
  const rootPub = authorityKeyPair(b4a.toString(host.key, 'hex')).publicKey
  for (const node of nodes) {
    const v = node.value
    if (!v) continue
    if (v.op === 'addWriter') {
      const key = b4a.from(v.addWriter, 'hex')
      const sig = b4a.from(v.sig, 'hex')
      if (!crypto.verify(key, sig, rootPub)) continue
      debug('apply: addWriter ' + key.toString('hex').slice(0, 10))
      await host.addWriter(key, { indexer: true })
    } else if (v.op === 'removeWriter') {
      const key = b4a.from(v.removeWriter, 'hex')
      const sig = b4a.from(v.sig, 'hex')
      const message = b4a.concat([b4a.from('removeWriter'), key])
      if (!crypto.verify(message, sig, rootPub)) continue
      debug('apply: removeWriter ' + key.toString('hex').slice(0, 10))
      try {
        await host.removeWriter(key)
      } catch (err) {
        // Deterministic guard (e.g. "last indexer") — same outcome on every
        // peer applying this op, so it's safe to just skip.
        debug('apply: removeWriter rejected: ' + (err as Error).message)
      }
    } else if (v.op === 'put') {
      const viewNode = await view.get(v.path)
      const existing: StoredBlob | null = viewNode ? viewNode.value : null
      const isRealConflict = existing !== null &&
        existing.device !== v.blob.device &&
        !sameContent(existing, v.blob) &&
        !isSequentialEdit(v.basedOn, existing)
      if (isRealConflict) {
        await view.put(await uniqueConflictPath(view, v.path, deviceLabel(existing!.device)), existing)
      }
      await view.put(v.path, { ...v.blob, seq: node.length })
    } else if (v.op === 'del') {
      await view.del(v.path)
    }
  }
}

// Older builds left `meta:` keys in the view; file paths start with '/'.
function isFileEntry (key: string, value: any): boolean {
  return key.startsWith('/') && value !== null && typeof value === 'object' && value.id !== undefined
}

function openView (store: any): any {
  return new Hyperbee(store.get('fs'), { keyEncoding: 'utf-8', valueEncoding: 'json' })
}

// ---------------------------------------------------------------------------

export interface EngineOptions {
  /** DHT bootstrap override so tests can run on a local testnet. */
  bootstrap?: Array<{ host: string, port: number }>
  /** Local-change debounce (ms). */
  debounceMs?: number
  /** How long a file must stay unchanged before the watcher reports it (ms). */
  watchStabilityMs?: number
}

export class Engine extends EventEmitter {
  readonly configDir: string
  readonly syncDir: string
  identity: Identity

  private store: any
  private base: any
  private swarm: any
  private watcher: FSWatcher | null = null
  private blobsByDevice = new Map<string, any>()
  private snapshot = new Map<string, BlobRef>()
  private pending = new Set<string>()
  private debounceTimers = new Map<string, NodeJS.Timeout>()
  private syncTimer: NodeJS.Timeout | null = null
  private closed = false
  private busy = 0
  private discovery: any = null
  private connections = new Set<any>()
  private reconnectTimer: NodeJS.Timeout | null = null
  private reconnectAttempt = 0
  private suspended = false
  private lastError: string | null = null
  private opts: EngineOptions

  private constructor (identity: Identity, configDir: string, syncDir: string, opts: EngineOptions = {}) {
    super()
    this.identity = identity
    this.configDir = configDir
    this.syncDir = syncDir
    this.opts = opts
  }

  private static async boot (identity: Identity, syncDir: string, configDir: string, opts?: EngineOptions): Promise<Engine> {
    const engine = new Engine(identity, configDir, syncDir, opts)
    await engine.start()
    return engine
  }

  static async create (syncDir: string, configDir: string = defaultConfigDir(), opts?: EngineOptions): Promise<Engine> {
    return Engine.boot(createIdentity(), syncDir, configDir, opts)
  }

  static async open (syncDir: string, configDir: string = defaultConfigDir(), opts?: EngineOptions): Promise<Engine> {
    const identity = loadIdentity(configDir)
    if (!identity) throw new Error('peerbox is not set up on this device')
    return Engine.boot(identity, syncDir, configDir, opts)
  }

  static async restore (syncDir: string, phrase: string, configDir: string = defaultConfigDir(), opts?: EngineOptions): Promise<Engine> {
    return Engine.boot(restoreIdentity(phrase), syncDir, configDir, opts)
  }

  static async pair (syncDir: string, baseKey: string, configDir: string = defaultConfigDir(), opts?: EngineOptions): Promise<Engine> {
    return Engine.boot(pairIdentity(baseKey), syncDir, configDir, opts)
  }

  get status (): EngineStatus {
    if (this.closed) return 'idle'
    if (this.lastError !== null) return 'error'
    if (this.busy > 0) return 'syncing'
    if (!this.base) return 'idle'
    if (!this.base.writable) return 'waiting'
    // A single-device drive is idle, not waiting for peers that don't exist.
    if (this.connections.size === 0 && this.writerCount() > 1) return 'waiting'
    return 'idle'
  }

  /** Peers currently connected and replicating this drive. */
  get peers (): number {
    return this.connections.size
  }

  /** Last failure, or null. Sticky until work next succeeds. */
  get error (): string | null {
    return this.lastError
  }

  /** Drive key (hex) — null before setup completes. */
  get baseKey (): string | null {
    return this.identity.baseKey
  }

  /** Recovery phrase (words) — null for QR-paired devices. */
  get phrase (): string | null {
    return this.identity.phrase
  }

  /** Devices currently authorized to write to this drive (local device included). */
  listDevices (): DeviceInfo[] {
    if (!this.base) return []
    const localKey = this.base.local.key.toString('hex')
    const devices: DeviceInfo[] = []
    for (const w of this.base.activeWriters) {
      if (w.isRemoved) continue
      const key: string = w.core.key.toString('hex')
      devices.push({ key, label: deviceLabel(key), isLocal: key === localKey })
    }
    return devices.sort((a, b) => Number(b.isLocal) - Number(a.isLocal) || a.label.localeCompare(b.label))
  }

  private writerCount (): number {
    let n = 0
    for (const w of this.base.activeWriters) if (!w.isRemoved) n++
    return n
  }

  /**
   * Revoke a linked device's write access. Doesn't wipe what it already has,
   * and it could rejoin with the drive key — see PLAN.md.
   */
  async revokeDevice (deviceKey: string): Promise<void> {
    if (!this.base || !this.identity.baseKey) throw new Error('drive key not ready')
    if (deviceKey === this.base.local.key.toString('hex')) throw new Error('cannot revoke this device')
    const key = b4a.from(deviceKey, 'hex')
    const sig = signRemoveWriter(this.identity.baseKey, key)
    await this.base.append(
      { op: 'removeWriter', removeWriter: deviceKey, sig },
      { optimistic: true }
    )
  }

  async start (): Promise<void> {
    mkdirSync(this.syncDir, { recursive: true })
    mkdirSync(this.configDir, { recursive: true })

    this.store = new Corestore(join(this.configDir, 'data'))
    await this.store.ready()

    // The first device bootstraps the autobase; everyone else opens it by key.
    const baseOpts = { valueEncoding: 'json', optimistic: true, open: openView, apply: applyOps }
    if (this.identity.isBootstrap) {
      const phrase = this.identity.phrase
      if (!phrase) throw new Error('Bootstrap identity missing recovery phrase')
      this.base = new Autobase(this.store, null, { ...baseOpts, keyPair: bootstrapKeyPair(phrase) })
    } else {
      const baseKey = this.identity.baseKey ?? this.deriveBaseKey()
      this.base = new Autobase(this.store, b4a.from(baseKey, 'hex'), baseOpts)
    }
    await this.base.ready()
    this.identity.baseKey = this.base.key.toString('hex')
    saveIdentity(this.identity, this.configDir)
    this.saveConfig()

    // Own blobs core (keyed by this device's writer key).
    this.getBlobs(this.base.local.key.toString('hex'))

    // Network first, so a joined device can be acknowledged by a peer.
    this.swarm = new Hyperswarm(this.opts.bootstrap ? { bootstrap: this.opts.bootstrap } : {})
    this.swarm.on('connection', (conn: any) => this.handleConnection(conn))
    this.discovery = this.swarm.join(this.base.discoveryKey, { server: true, client: true })
    // Announce in the background: flushing waits on the DHT, which never
    // settles while offline, and the engine must start with no network.
    this.discovery.flushed()
      .then(() => debug('announced ' + this.base.discoveryKey.toString('hex').slice(0, 12)))
      .catch((err: Error) => debug('announce failed: ' + err.message))

    this.base.on('update', () => this.scheduleSync())
    this.base.on('writable', () => {
      debug('became writable')
      this.emit('status', this.status)
      this.flushPending()
    })
    this.base.on('error', (err: Error) => this.fail(err))

    // Join/restore/pair: self-authorize this device's writer (once).
    if (!this.identity.isBootstrap) {
      await this.base.update()
      debug('writable=' + this.base.writable + ' local=' + this.base.local.key.toString('hex').slice(0, 10))
      if (!this.base.writable) this.selfAuthorize()
    }

    // What was on disk when we last ran, so changes made while stopped
    // (deletes here, deletes elsewhere) aren't undone by the passes below.
    this.snapshot = this.loadDiskState()
    this.startWatcher()
    await this.base.update()
    await this.reconcileOfflineDeletes()
    await this.base.update()
    await this.syncToDisk().catch((err: Error) => this.fail(err))
    this.scheduleReconnect()
  }

  async stop (): Promise<void> {
    this.closed = true
    this.clearReconnect()
    this.connections.clear()
    if (this.syncTimer) clearTimeout(this.syncTimer)
    for (const t of this.debounceTimers.values()) clearTimeout(t)
    this.debounceTimers.clear()
    this.pending.clear()
    if (this.watcher) await this.watcher.close()
    this.watcher = null
    if (this.swarm) await this.swarm.destroy()
    if (this.base) await this.base.close()
    if (this.store) await this.store.close()
  }

  // -- connectivity ----------------------------------------------------------

  private handleConnection (conn: any): void {
    this.connections.add(conn)
    debug('peer connected (' + this.connections.size + ' total)')
    this.reconnectAttempt = 0
    this.clearReconnect()
    // A dropped socket is a reconnect, not a failure to show the user.
    conn.on('error', (err: Error) => debug('peer error: ' + err.message))
    conn.on('close', () => {
      this.connections.delete(conn)
      debug('peer disconnected (' + this.connections.size + ' left)')
      this.emit('status', this.status)
      this.scheduleReconnect()
    })
    this.base.replicate(conn)
    this.emit('status', this.status)
  }

  /**
   * Re-announce and look for peers. Hyperswarm's own network-change refresh
   * misses VPN/sleep/container cases, so the backoff loop calls this too.
   */
  async reconnect (): Promise<void> {
    if (this.closed || !this.swarm) return
    if (this.swarm.suspended) await this.swarm.resume()
    this.suspended = false
    this.discovery = this.swarm.join(this.base.discoveryKey, { server: true, client: true })
    await this.discovery.refresh({ client: true, server: true })
    debug('re-announced (peers=' + this.connections.size + ')')
  }

  /** Re-run failed work; the error clears only once a sync succeeds. */
  async retry (): Promise<void> {
    if (this.closed) return
    try {
      await this.base.update()
      await this.syncToDisk()
    } catch (err) {
      this.fail(err as Error)
    }
  }

  /** Sleep/wake hooks: sockets don't survive a suspend. */
  async suspend (): Promise<void> {
    if (this.closed || this.suspended || !this.swarm) return
    this.suspended = true
    this.clearReconnect()
    await this.swarm.suspend()
    debug('suspended')
    this.emit('status', this.status)
  }

  async resume (): Promise<void> {
    if (this.closed || !this.suspended) return
    this.reconnectAttempt = 0
    await this.reconnect().catch((err: Error) => debug('resume failed: ' + err.message))
    debug('resumed')
    this.scheduleReconnect()
    this.emit('status', this.status)
  }

  // Somebody is expected: this writer isn't acknowledged yet, or the drive
  // has other devices.
  private expectsPeers (): boolean {
    return !this.base.writable || this.writerCount() > 1
  }

  private scheduleReconnect (): void {
    if (this.closed || this.suspended || this.reconnectTimer) return
    if (this.connections.size > 0 || !this.expectsPeers()) return
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** this.reconnectAttempt++)
    debug('reconnecting in ' + delay + 'ms')
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.reconnect()
        .catch((err: Error) => debug('reconnect failed: ' + err.message))
        .finally(() => this.scheduleReconnect())
    }, delay)
  }

  private clearReconnect (): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }

  // -- errors ------------------------------------------------------------------

  // Sticky: status stays `error` until work next succeeds, so a failure that
  // happened while nobody was watching isn't lost in a log.
  private fail (err: Error): void {
    this.lastError = err.message
    debug('error: ' + err.message)
    // An unhandled 'error' event *throws*, killing the process over one bad
    // file. Hosts that don't subscribe still get it via status + `error`.
    if (this.listenerCount('error') > 0) this.emit('error', err)
    this.emit('status', this.status)
  }

  // -- drive keys ----------------------------------------------------------

  private deriveBaseKey (): string {
    // Derive the drive key without loading the keypair: a writable bootstrap
    // core would become the local writer and fork the drive.
    const phrase = this.identity.phrase
    if (!phrase) throw new Error('No drive key and no recovery phrase to derive one')
    const kp = bootstrapKeyPair(phrase)
    const manifest = { version: this.store.manifestVersion, signers: [{ publicKey: kp.publicKey }] }
    return Hypercore.key(manifest).toString('hex')
  }

  // -- writer authorization ------------------------------------------------

  private selfAuthorize (): void {
    const writerKey = this.base.local.key
    const sig = signAddWriter(this.identity.baseKey!, writerKey)
    debug('self-authorizing writer ' + writerKey.toString('hex').slice(0, 10))
    this.base.append(
      { op: 'addWriter', addWriter: writerKey.toString('hex'), sig },
      { optimistic: true }
    ).catch((err: Error) => this.fail(err))
  }

  // -- blob storage --------------------------------------------------------

  private blobsKeyPair (deviceWriterKey: string): KeyPair {
    return crypto.keyPair(crypto.hash(b4a.from('peerbox/blobs:' + deviceWriterKey)))
  }

  private getBlobs (deviceWriterKey: string): any {
    let blobs = this.blobsByDevice.get(deviceWriterKey)
    if (!blobs) {
      blobs = new Hyperblobs(this.store.get({ keyPair: this.blobsKeyPair(deviceWriterKey) }))
      this.blobsByDevice.set(deviceWriterKey, blobs)
    }
    return blobs
  }

  // -- local changes -> autobase -------------------------------------------

  private startWatcher (): void {
    this.watcher = watch(this.syncDir, {
      ignoreInitial: false,
      ignored: (path: string) => path.includes('.peerbox-tmp') || isIgnoredFile(path),
      // A file still being written (a large copy in progress) must not be
      // reported yet — snapshotting it mid-copy would sync a truncated file.
      awaitWriteFinish: {
        stabilityThreshold: this.opts.watchStabilityMs ?? 2000,
        pollInterval: 100
      }
    })
    this.watcher.on('add', (path: string) => this.debounceChange(path))
    this.watcher.on('change', (path: string) => this.debounceChange(path))
    this.watcher.on('unlink', (path: string) => this.debounceChange(path))
  }

  private debounceChange (absPath: string): void {
    const prev = this.debounceTimers.get(absPath)
    if (prev) clearTimeout(prev)
    const t = setTimeout(() => {
      this.debounceTimers.delete(absPath)
      this.handleLocalChange(absPath).catch((err: Error) => this.fail(err))
    }, this.opts.debounceMs ?? 250)
    this.debounceTimers.set(absPath, t)
  }

  private flushPending (): void {
    const paths = [...this.pending]
    this.pending.clear()
    for (const absPath of paths) {
      this.handleLocalChange(absPath).catch((err: Error) => this.fail(err))
    }
  }

  private async handleLocalChange (absPath: string): Promise<void> {
    if (this.closed) return

    // Not writable yet: queue until the `writable` event instead of dropping.
    if (!this.base.writable) {
      this.pending.add(absPath)
      return
    }

    const relPath = normalizePath(relative(this.syncDir, absPath).split(sep).join('/'))

    if (!existsSync(absPath)) {
      // Del only if the view still holds the path — filters the echo of our
      // own view->disk unlink (the entry is already gone by then).
      if ((await this.base.view.get(relPath)) === null) return
      debug('local del ' + relPath)
      await this.appendOp({ op: 'del', path: relPath })
      return
    }

    const stat = statSync(absPath)
    if (!stat.isFile()) return

    const viewNode = await this.base.view.get(relPath)
    const existing: StoredBlob | null = viewNode ? viewNode.value : null

    // Skip unchanged files (startup scan, echoes of our own writes) to avoid
    // spurious conflicted copies.
    if (existing && await this.matchesLocal(existing, absPath, stat.size)) return

    // An echo of our own write after a remote delete must not resurrect the file.
    const materialized = this.snapshot.get(relPath) as StoredBlob | undefined
    if (materialized && await this.matchesLocal(materialized, absPath, stat.size)) return

    const { id, size, hash } = await this.uploadBlob(absPath)
    debug('local put ' + relPath + ' (' + size + ' bytes)')
    await this.appendOp({
      op: 'put',
      path: relPath,
      blob: { device: this.base.local.key.toString('hex'), id, size, hash },
      // What this edit supersedes, so a peer applying it later can tell a
      // normal sequential edit from a real concurrent conflict.
      basedOn: existing && typeof existing.seq === 'number'
        ? { device: existing.device, seq: existing.seq }
        : null
    })
  }

  /** Does the local file already match the version recorded in the view? */
  private async matchesLocal (existing: StoredBlob, absPath: string, size: number): Promise<boolean> {
    if (typeof existing.hash === 'string' && typeof existing.size === 'number') {
      if (size !== existing.size) return false
      return (await hashFile(absPath)) === existing.hash
    }
    // Legacy entry recorded before size/hash existed: compare actual bytes.
    const current = await this.getBlobs(existing.device).get(existing.id, { wait: false }).catch(() => null)
    return current !== null && b4a.equals(current, readFileSync(absPath))
  }

  /** Stream a local file into this device's blobs core, hashing as it goes. */
  private async uploadBlob (absPath: string): Promise<{ id: BlobId, size: number, hash: string }> {
    const blobs = this.getBlobs(this.base.local.key.toString('hex'))
    const source = createReadStream(absPath)
    const hasher = createHash('sha256')
    let size = 0
    source.on('data', (chunk: Buffer) => {
      hasher.update(chunk)
      size += chunk.length
    })
    const sink = blobs.createWriteStream()
    await pipelinePromise(source, sink)
    return { id: sink.id, size, hash: hasher.digest('hex') }
  }

  private async appendOp (op: PutOp | DelOp): Promise<void> {
    if (!this.base.writable) return
    this.busy++
    try {
      await this.base.append(op)
      this.lastError = null
    } finally {
      this.busy--
    }
    this.emit('status', this.status)
  }

  // -- autobase view -> disk ------------------------------------------------

  private scheduleSync (): void {
    if (this.closed) return
    if (this.syncTimer) clearTimeout(this.syncTimer)
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null
      this.syncToDisk().catch((err: Error) => this.fail(err))
    }, 300)
  }

  private async syncToDisk (): Promise<void> {
    if (this.closed) return
    this.busy++
    let failure: Error | null = null
    try {
      const next = new Map<string, BlobRef>()
      for await (const { key, value } of this.base.view.createReadStream()) {
        // Ignored junk in the log (e.g. .DS_Store from older builds) is
        // neither written to disk nor deleted from it.
        if (isFileEntry(key as string, value) && !isIgnoredFile(key as string)) {
          next.set(key as string, value as BlobRef)
        }
      }

      // Write new/changed files. One bad file must not stop the others.
      const localKey = this.base.local.key.toString('hex')
      const retry = new Set<string>()
      for (const [path, blob] of next) {
        const prev = this.snapshot.get(path)
        if (prev && sameBlob(prev, blob)) continue
        try {
          // Our own blob: disk is the source, rewriting could clobber a newer edit.
          if (blob.device === localKey && existsSync(this.diskPath(path))) continue
          await this.writeFromView(path, blob)
        } catch (err) {
          failure ??= err as Error
          retry.add(path)
        }
      }

      // Remove files no longer in the view.
      for (const [path, prev] of this.snapshot) {
        if (next.has(path)) continue
        const absPath = this.diskPath(path)
        // Edited locally since we wrote it: keep the edit, the watcher re-adds it.
        if (existsSync(absPath) && !(await this.matchesLocal(prev, absPath, statSync(absPath).size))) continue
        rmSync(absPath, { force: true })
      }

      this.snapshot = next
      // Keep failed paths out of the snapshot so the next pass retries them.
      for (const path of retry) this.snapshot.delete(path)
      this.saveDiskState()
    } finally {
      this.busy--
    }
    if (failure) return this.fail(failure)
    this.lastError = null
    this.emit('status', this.status)
  }

  private diskPath (viewPath: string): string {
    return join(this.syncDir, viewPath.slice(1))
  }

  private async writeFromView (path: string, blob: BlobRef): Promise<void> {
    const absPath = this.diskPath(path)
    mkdirSync(dirname(absPath), { recursive: true })
    // Temp file + rename: a half-written file is never observable, and a
    // crash mid-download leaves only a watcher-ignored temp file behind.
    const tmpPath = join(dirname(absPath), '.peerbox-tmp-' + randomBytes(6).toString('hex'))
    const source = this.getBlobs(blob.device).createReadStream(blob.id, { wait: true })
    try {
      await pipelinePromise(source, createWriteStream(tmpPath))
      renameSync(tmpPath, absPath)
    } finally {
      rmSync(tmpPath, { force: true })
    }
  }

  // -- disk state across restarts -------------------------------------------

  /**
   * A file we wrote, still in the view at that version, but missing from disk
   * now was deleted while the engine was stopped: record the delete.
   */
  private async reconcileOfflineDeletes (): Promise<void> {
    const missing = [...this.snapshot.keys()].filter(path => !existsSync(this.diskPath(path)))
    // Nothing from last run is on disk: more likely an unmounted drive or a
    // wiped folder than a mass delete, so download everything again.
    if (missing.length === this.snapshot.size) {
      this.snapshot.clear()
      return
    }
    for (const path of missing) {
      const node = await this.base.view.get(path)
      if (this.base.writable && node && sameBlob(node.value, this.snapshot.get(path)!)) {
        debug('offline del ' + path)
        await this.appendOp({ op: 'del', path })
      } else {
        // Changed elsewhere since (or not writable yet): download it again.
        this.snapshot.delete(path)
      }
    }
  }

  // Only valid for the folder it was recorded in; a changed folder starts fresh.
  private loadDiskState (): Map<string, BlobRef> {
    try {
      const state = JSON.parse(readFileSync(join(this.configDir, 'disk-state.json'), 'utf8'))
      if (resolve(state.syncDir) !== resolve(this.syncDir)) return new Map()
      return new Map(Object.entries(state.files as Record<string, BlobRef>))
    } catch {
      return new Map()
    }
  }

  private saveDiskState (): void {
    const file = join(this.configDir, 'disk-state.json')
    const state = { syncDir: this.syncDir, files: Object.fromEntries(this.snapshot) }
    // Temp + rename: a crash mid-write must not leave a truncated state file.
    writeFileSync(file + '.tmp', JSON.stringify(state))
    renameSync(file + '.tmp', file)
  }

  // -- config ----------------------------------------------------------------

  private saveConfig (): void {
    writeFileSync(join(this.configDir, 'config.json'), JSON.stringify({ syncDir: this.syncDir }, null, 2))
  }
}
