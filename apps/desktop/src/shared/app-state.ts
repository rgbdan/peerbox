// What the window shows: setup (no drive yet) or the status view.

import type { EngineStatus } from '@peerbox/core'

/** Engine status plus the state the engine itself can't represent. */
export type HostStatus = EngineStatus | 'not-setup'

/** The live part of the status view, pushed on every status change. */
export interface StatusUpdate {
  status: HostStatus
  label: string
  peers: number
  error: string | null
}

/** The manual update check (src/engine/updates.ts). */
export interface UpdateState {
  current: string
  /** Newest published version, once a check has succeeded. */
  latest: string | null
  available: boolean
  checkedAt: number | null
  error: string | null
}

export type AppState =
  | { view: 'setup', defaultDir: string }
  | ({
      view: 'status'
      baseKey: string
      syncDir: string
      hasPhrase: boolean
      autostartEnabled: boolean
    } & StatusUpdate)
