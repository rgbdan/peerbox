// Packages the desktop app for this OS (`--dir` skips installers).
// Steps: bundle engine -> stage native addons -> stage Node -> vite -> tauri build.

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hostTriple } from './host-triple.mjs'

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const stageDir = join(desktopDir, 'src-tauri', 'engine')
const dirOnly = process.argv.includes('--dir')

// npm/npx are .cmd shims on Windows, which only run through a shell.
function run (cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
}

// --- 1. engine sidecar ------------------------------------------------------
run('node', ['scripts/build-engine.mjs'], desktopDir)

// --- 2. stage native addons next to the sidecar -----------------------------
const desktopPkg = JSON.parse(readFileSync(join(desktopDir, 'package.json'), 'utf8'))
const nativeDeps = ['fs-native-extensions', 'quickbit-native', 'rabin-native', 'rocksdb-native', 'simdle-native', 'sodium-native', 'udx-native']
const dependencies = Object.fromEntries(
  Object.entries(desktopPkg.dependencies).filter(([name]) => nativeDeps.includes(name))
)

rmSync(stageDir, { recursive: true, force: true })
mkdirSync(stageDir, { recursive: true })
copyFileSync(join(desktopDir, 'dist/engine/sidecar.cjs'), join(stageDir, 'sidecar.cjs'))
writeFileSync(join(stageDir, 'package.json'), JSON.stringify({
  name: 'peerbox-engine',
  private: true,
  dependencies
}, null, 2))
run('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--loglevel=error'], stageDir)

// Keep only this host's prebuilds. Names differ from Rust triples
// (aarch64-apple-darwin -> darwin-arm64).
function pruneForeignPrebuilds () {
  const triple = hostTriple()
  const os = triple.includes('apple') ? 'darwin'
    : triple.includes('linux') ? 'linux'
      : triple.includes('windows') ? 'win32' : 'unknown'
  const arch = triple.includes('aarch64') ? 'arm64'
    : triple.includes('x86_64') ? 'x64' : 'unknown'
  const keep = [`${os}-${arch}`, `${os}-universal`, 'node-abi']

  const prebuildDir = join(stageDir, 'node_modules')
  for (const entry of readdirSync(prebuildDir)) {
    if (entry.startsWith('.') || entry.startsWith('@')) continue
    const prebuilds = join(prebuildDir, entry, 'prebuilds')
    if (!existsSync(prebuilds)) continue
    for (const platform of readdirSync(prebuilds)) {
      if (!keep.includes(platform)) {
        rmSync(join(prebuilds, platform), { recursive: true, force: true })
      }
    }
  }
}
pruneForeignPrebuilds()

// --- 3. Node runtime as a Tauri external binary -----------------------------
// Ships the system Node as externalBin `node-<target-triple>`.
run('node', ['scripts/stage-node.mjs'], desktopDir)

// --- 4. renderer ------------------------------------------------------------
run('npx', ['vite', 'build'], desktopDir)

// --- 5. package -------------------------------------------------------------
run('npx', ['tauri', 'build', ...(dirOnly ? ['--no-bundle'] : [])], desktopDir)

console.log('\nartifacts in src-tauri/target/release/bundle/')
