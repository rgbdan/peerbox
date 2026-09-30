import type { DeviceInfo } from '@peerbox/core'
import type { AppState, StatusUpdate, UpdateState } from '../shared/app-state'

export interface PeerboxBridge {
  quit: () => void
  onStatus: (callback: (update: StatusUpdate) => void) => void
  getState: () => Promise<AppState>
  onStateChanged: (callback: () => void) => void
  getPhrase: () => Promise<string | null>
  openFolder: () => void
  changeFolder: () => Promise<void>
  setAutostart: (enabled: boolean) => Promise<void>
  listDevices: () => Promise<DeviceInfo[]>
  retry: () => Promise<void>
  revokeDevice: (deviceKey: string) => Promise<void>
  chooseFolder: () => Promise<string | null>
  createDrive: (syncDir: string) => Promise<{ phrase: string }>
  joinDrive: (baseKey: string, syncDir: string) => Promise<void>
  restoreDrive: (phrase: string, syncDir: string) => Promise<void>
  getUpdateState: () => Promise<UpdateState>
  checkForUpdates: () => Promise<UpdateState>
  openDownload: () => void
  onUpdate: (callback: (state: UpdateState) => void) => void
}

declare global {
  interface Window {
    peerbox: PeerboxBridge
  }
}
