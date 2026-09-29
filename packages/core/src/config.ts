// On-disk app config (~/.config/peerbox/config.json), shared by the headless
// daemon and the desktop shell.

import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

interface Config {
  syncDir?: string
}

/** The synced folder for this device, falling back to ~/Peerbox. */
export function loadSyncDir (configDir: string): string {
  const file = join(configDir, 'config.json')
  if (existsSync(file)) {
    try {
      const config = JSON.parse(readFileSync(file, 'utf8')) as Config
      if (config.syncDir) return config.syncDir
    } catch {
      // Corrupt config: fall through to the default.
    }
  }
  return join(homedir(), 'Peerbox')
}
