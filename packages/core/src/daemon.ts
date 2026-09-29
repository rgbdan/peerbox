// Headless entrypoint (servers, Raspberry Pi).
// Commands: create [dir] | restore <phrase> [dir] | pair <baseKey> [dir] | status | --daemon [dir]

import { loadSyncDir } from './config'
import { Engine } from './engine'
import { configDir, loadIdentity } from './identity'

async function main (): Promise<void> {
  const argv = process.argv.slice(2)
  const cmd = argv[0] || '--daemon'
  const dir = configDir()

  if (cmd === 'create') {
    const syncDir = argv[1] || loadSyncDir(dir)
    const engine = await Engine.create(syncDir, dir)
    console.log('Drive created.')
    console.log('Recovery phrase (write it down — it is your account):')
    console.log('  ' + engine.phrase)
    console.log('Syncing folder: ' + engine.syncDir)
    await engine.stop()
    return
  }

  if (cmd === 'restore') {
    const phrase = argv[1]
    if (!phrase) {
      console.error('usage: peerbox restore "<12-word phrase>" [dir]')
      process.exit(1)
    }
    const syncDir = argv[2] || loadSyncDir(dir)
    const engine = await Engine.restore(syncDir, phrase, dir)
    console.log('Restored. Syncing folder: ' + engine.syncDir)
    await engine.stop()
    return
  }

  if (cmd === 'pair') {
    const baseKey = argv[1]
    if (!baseKey) {
      console.error('usage: peerbox pair <baseKey> [dir]')
      process.exit(1)
    }
    const syncDir = argv[2] || loadSyncDir(dir)
    const engine = await Engine.pair(syncDir, baseKey, dir)
    console.log('Paired. Syncing folder: ' + engine.syncDir)
    await engine.stop()
    return
  }

  if (cmd === 'status') {
    const identity = loadIdentity(dir)
    if (!identity) {
      console.log('not set up — run: peerbox create [dir]')
    } else {
      console.log('baseKey: ' + identity.baseKey)
      console.log('isBootstrap: ' + identity.isBootstrap)
      console.log('phrase: ' + (identity.phrase ? 'known' : 'not stored'))
      console.log('syncDir: ' + loadSyncDir(dir))
    }
    return
  }

  if (cmd !== '--daemon') {
    console.error('unknown command: ' + cmd)
    process.exit(1)
  }

  const identity = loadIdentity(dir)
  if (!identity) {
    console.error('peerbox is not set up. Run: peerbox create [dir]')
    process.exit(1)
  }

  const syncDir = argv[1] || loadSyncDir(dir)
  const engine = await Engine.open(syncDir, dir)
  engine.on('status', (s: string) => console.log('[status] ' + s))
  engine.on('error', (e: Error) => console.error('[error]', e))
  console.log('daemon running — syncDir: ' + engine.syncDir + ' baseKey: ' + engine.baseKey)

  const shutdown = async (): Promise<void> => {
    await engine.stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
