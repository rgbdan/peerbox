// Two real engines on a local DHT testnet (no public network).

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import createTestnet from 'hyperdht/testnet'
import { Engine, type EngineOptions } from '../src/engine'

// Fast-but-realistic timings: real debounce shape, just shorter.
const TEST_ENGINE_OPTS = { debounceMs: 50, watchStabilityMs: 150 }

export interface TestDevice {
  engine: Engine
  syncDir: string
  configDir: string
}

export class Harness {
  private testnet: any = null
  private root: string
  private devices: TestDevice[] = []
  private n = 0

  private constructor () {
    this.root = mkdtempSync(join(tmpdir(), 'peerbox-test-'))
  }

  static async create (): Promise<Harness> {
    const h = new Harness()
    h.testnet = await createTestnet(3)
    return h
  }

  get bootstrap (): Array<{ host: string, port: number }> {
    return this.testnet.bootstrap
  }

  private dirs (): { syncDir: string, configDir: string } {
    const id = String(this.n++)
    const syncDir = join(this.root, 'sync' + id)
    const configDir = join(this.root, 'config' + id)
    mkdirSync(syncDir, { recursive: true })
    return { syncDir, configDir }
  }

  private opts (extra?: EngineOptions): EngineOptions {
    return { bootstrap: this.bootstrap, ...TEST_ENGINE_OPTS, ...extra }
  }

  private track (engine: Engine, syncDir: string, configDir: string): TestDevice {
    const device = { engine, syncDir, configDir }
    this.devices.push(device)
    return device
  }

  /** First device: bootstraps a fresh drive. */
  async createDevice (extra?: EngineOptions): Promise<TestDevice> {
    const { syncDir, configDir } = this.dirs()
    return this.track(await Engine.create(syncDir, configDir, this.opts(extra)), syncDir, configDir)
  }

  /** Link a device by drive key (the QR/paste flow). `seed` pre-populates
   * the sync folder before the engine starts (a real join scenario). */
  async pairDevice (baseKey: string, extra?: EngineOptions, seed?: Record<string, string | Buffer>): Promise<TestDevice> {
    const { syncDir, configDir } = this.dirs()
    for (const [rel, content] of Object.entries(seed ?? {})) writeFile(syncDir, rel, content)
    return this.track(await Engine.pair(syncDir, baseKey, configDir, this.opts(extra)), syncDir, configDir)
  }

  /** Restore a device from the recovery phrase. */
  async restoreDevice (phrase: string, extra?: EngineOptions): Promise<TestDevice> {
    const { syncDir, configDir } = this.dirs()
    return this.track(await Engine.restore(syncDir, phrase, configDir, this.opts(extra)), syncDir, configDir)
  }

  /** Stop a device's engine (keeps its dirs for a later reopen). */
  async stopDevice (device: TestDevice): Promise<void> {
    await device.engine.stop()
    this.devices = this.devices.filter(d => d !== device)
  }

  /** Reopen a previously stopped device from its persisted config. */
  async reopenDevice (device: TestDevice, extra?: EngineOptions): Promise<TestDevice> {
    return this.track(
      await Engine.open(device.syncDir, device.configDir, this.opts(extra)),
      device.syncDir,
      device.configDir
    )
  }

  async destroy (): Promise<void> {
    for (const d of this.devices.splice(0)) {
      await d.engine.stop().catch(() => {})
    }
    if (this.testnet) await this.testnet.destroy()
    rmSync(this.root, { recursive: true, force: true })
  }
}

// -- filesystem helpers ------------------------------------------------------

export function writeFile (dir: string, relPath: string, content: string | Buffer): void {
  const abs = join(dir, relPath)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content)
}

export function readFile (dir: string, relPath: string): Buffer | null {
  const abs = join(dir, relPath)
  return existsSync(abs) ? readFileSync(abs) : null
}

export function listFiles (dir: string, prefix = ''): string[] {
  const out: string[] = []
  for (const entry of readdirSync(join(dir, prefix), { withFileTypes: true })) {
    const rel = prefix ? prefix + '/' + entry.name : entry.name
    if (entry.isDirectory()) out.push(...listFiles(dir, rel))
    else out.push(rel)
  }
  return out.sort()
}

// -- waiting -----------------------------------------------------------------

export async function waitFor (
  check: () => boolean | Promise<boolean>,
  what: string,
  timeoutMs = 30_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await sleep(100)
  }
  throw new Error('timed out waiting for ' + what)
}

/** Wait until dir/relPath exists with exactly `content`. */
export async function waitForFile (dir: string, relPath: string, content: string | Buffer): Promise<void> {
  const expected = Buffer.from(content)
  await waitFor(() => {
    const actual = readFile(dir, relPath)
    return actual !== null && actual.equals(expected)
  }, `${relPath} to sync into ${dir}`)
}

export async function waitForGone (dir: string, relPath: string): Promise<void> {
  await waitFor(() => readFile(dir, relPath) === null, `${relPath} to be deleted from ${dir}`)
}

/** Wait until the engine settles back to a non-syncing status. */
export async function waitForIdle (engine: Engine): Promise<void> {
  await waitFor(() => engine.status !== 'syncing', 'engine to settle')
}

export function sleep (ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
