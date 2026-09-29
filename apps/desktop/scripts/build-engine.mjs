// Bundles the engine sidecar into one file (`--watch` to rebuild on change).
// Native addons stay external; package.mjs stages them for release builds.

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const esbuild = require('esbuild')

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..')
const watch = process.argv.includes('--watch')

const ctx = await esbuild.context({
  entryPoints: [join(desktopDir, 'src/engine/sidecar.ts')],
  bundle: true,
  // The Holepunch stack is CJS with dynamic requires (e.g. events-universal,
  // require-addon); CJS output keeps those working without a node_modules.
  format: 'cjs',
  platform: 'node',
  target: 'node22',
  outfile: join(desktopDir, 'dist/engine/sidecar.cjs'),
  // Bundling breaks require-addon's prebuild lookup, so these load from node_modules.
  external: [
    'sodium-native',
    'require-addon',
    'rocksdb-native',
    'udx-native',
    'fs-native-extensions',
    'quickbit-native',
    'rabin-native',
    'simdle-native'
  ],
  logLevel: 'info'
})

if (watch) {
  await ctx.watch()
  console.log('[build-engine] watching src/engine/')
} else {
  await ctx.rebuild()
  await ctx.dispose()
}
