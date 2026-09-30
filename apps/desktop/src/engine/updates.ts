// Update check, run only when the user clicks "Check now": asks GitHub which
// release is latest. It is the only request peerbox makes to anything but
// your own devices.

import { EventEmitter } from 'node:events'
import type { UpdateState } from '../shared/app-state'

const LATEST_URL = 'https://github.com/rgbdan/peerbox/releases/latest'

/** "1.2.3" or "v1.2.3" -> [1, 2, 3]; anything else (pre-releases too) -> null. */
export function parseVersion (version: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  return match ? match.slice(1).map(Number) : null
}

export function isNewer (latest: string, current: string): boolean {
  const a = parseVersion(latest)
  const b = parseVersion(current)
  if (!a || !b) return false
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i]
  }
  return false
}

/** GitHub redirects /releases/latest to /releases/tag/<tag>: no API, no rate limit. */
export async function fetchLatestVersion (): Promise<string> {
  const res = await fetch(LATEST_URL, {
    method: 'HEAD',
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000)
  })
  const location = res.headers.get('location') ?? ''
  const tag = /\/releases\/tag\/([^/?#]+)$/.exec(location)?.[1]
  if (!tag) throw new Error('no published release found')
  const version = decodeURIComponent(tag).replace(/^v/, '')
  if (!parseVersion(version)) throw new Error(`unrecognised release tag: ${tag}`)
  return version
}

export class UpdateChecker extends EventEmitter {
  private latest: string | null = null
  private checkedAt: number | null = null
  private error: string | null = null
  private inflight: Promise<UpdateState> | null = null

  constructor (
    private readonly current: string,
    private readonly fetchLatest: () => Promise<string> = fetchLatestVersion
  ) {
    super()
  }

  get state (): UpdateState {
    return {
      current: this.current,
      latest: this.latest,
      available: this.latest !== null && isNewer(this.latest, this.current),
      checkedAt: this.checkedAt,
      error: this.error
    }
  }

  /** One check; a double click shares the request in flight. */
  check (): Promise<UpdateState> {
    this.inflight ??= (async () => {
      try {
        this.latest = await this.fetchLatest()
        this.error = null
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err)
      } finally {
        this.checkedAt = Date.now()
        this.inflight = null
      }
      this.emit('update', this.state)
      return this.state
    })()
    return this.inflight
  }
}
