// Copies the system Node to src-tauri/binaries/node-<target-triple> (Tauri
// externalBin). tauri-build fails without it, even in dev.

import { copyFileSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hostTriple } from './host-triple.mjs'

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..')

// tauri-build hard-fails while the declared resource directory is missing, so
// keep it present even before the first packaging run.
mkdirSync(join(desktopDir, 'src-tauri', 'engine'), { recursive: true })

const binariesDir = join(desktopDir, 'src-tauri', 'binaries')
const ext = process.platform === 'win32' ? '.exe' : ''
const target = join(binariesDir, `node-${hostTriple()}${ext}`)

let stale = true
try {
  const targetStat = statSync(target)
  const nodeStat = statSync(process.execPath)
  stale = targetStat.mtimeMs < nodeStat.mtimeMs || targetStat.size !== nodeStat.size
} catch {
  stale = true
}

if (stale) {
  mkdirSync(binariesDir, { recursive: true })
  copyFileSync(process.execPath, target)
  console.log(`[stage-node] ${target}`)
}
