// Installs window.peerbox (the old Electron preload surface) on top of Tauri IPC.

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { AppState, StatusUpdate } from '../shared/app-state'

async function fire (command: string, args?: Record<string, unknown>): Promise<void> {
  try {
    await invoke(command, args)
  } catch (err) {
    console.error(`[peerbox] ${command} failed:`, err)
  }
}

export function installBridge (): void {
  window.peerbox = {
    quit: () => { void fire('quit') },
    onStatus: (callback) => {
      void listen<StatusUpdate>('status', (event) => callback(event.payload))
    },
    getState: () => invoke<AppState>('get_state'),
    onStateChanged: (callback) => {
      void listen('app:state-changed', () => callback())
    },
    getPhrase: () => invoke<string | null>('get_phrase'),
    openFolder: () => { void fire('open_folder') },
    changeFolder: () => invoke('change_folder'),
    setAutostart: (enabled) => invoke('set_autostart', { enabled }),
    listDevices: () => invoke('list_devices'),
    retry: () => invoke('retry'),
    revokeDevice: (deviceKey) => invoke('revoke_device', { deviceKey }),
    chooseFolder: () => invoke<string | null>('choose_folder'),
    createDrive: (syncDir) => invoke('create_drive', { syncDir }),
    joinDrive: (baseKey, syncDir) => invoke('join_drive', { baseKey, syncDir }),
    restoreDrive: (phrase, syncDir) => invoke('restore_drive', { phrase, syncDir })
  }
}
