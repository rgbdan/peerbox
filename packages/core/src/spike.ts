// Phase 0 spike: two in-process devices write to one autobase and converge.
// (hyperdrive v13 is single-writer, hence autobase + a Hyperbee view.)

import { mkdirSync, rmSync } from 'node:fs'
import Corestore from 'corestore'
import Autobase from 'autobase'
import Hyperbee from 'hyperbee'
import b4a from 'b4a'

const A_DIR = './data/spike-a'
const B_DIR = './data/spike-b'

for (const dir of [A_DIR, B_DIR]) {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
}

/** Hyperbee view: path -> inline utf8 content (spike only). */
function open (store: any) {
  return new Hyperbee(store.get('fs'), { keyEncoding: 'utf-8', valueEncoding: 'binary' })
}

/** Replays ops into the view; must be deterministic (autobase may re-apply). */
async function apply (nodes: any[], view: any, host: any) {
  for (const node of nodes) {
    const v = node.value
    if (!v) continue // ack nodes are null

    if (v.op === 'addWriter') {
      await host.addWriter(b4a.from(v.addWriter, 'hex'), { indexer: true })
    } else if (v.op === 'put') {
      await view.put(v.path, b4a.from(v.content))
    } else if (v.op === 'del') {
      await view.del(v.path)
    }
  }
}

function makeBase (store: any, bootstrap: Buffer | null) {
  return new Autobase(store, bootstrap, {
    valueEncoding: 'json',
    open,
    apply
  })
}

async function waitFor (fn: () => Promise<boolean>, label: string, timeoutMs = 15000) {
  const start = Date.now()
  for (;;) {
    if (await fn()) return
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for: ${label}`)
    await new Promise((r) => setTimeout(r, 100))
  }
}

async function main () {
  const storeA = new Corestore(A_DIR)
  const storeB = new Corestore(B_DIR)

  // Device A bootstraps a brand new multi-writer filesystem.
  const baseA = makeBase(storeA, null)
  await baseA.ready()
  console.log('[A] bootstrapped base', baseA.key.toString('hex').slice(0, 16))

  // Device B joins using A's base key (in reality: delivered via QR pairing).
  const baseB = makeBase(storeB, baseA.key)
  await baseB.ready()
  console.log('[B] joined base       ', baseB.key.toString('hex').slice(0, 16))
  console.log('[B] writer key        ', baseB.local.key.toString('hex').slice(0, 16))

  // Direct replication link between the two corestores.
  // In reality: two Hyperswarms joining base.discoveryKey.
  const s1 = baseA.replicate(true)
  const s2 = baseB.replicate(false)
  s1.pipe(s2).pipe(s1)
  console.log('[net] replication link established')

  // Pairing: A authorizes B as a writer + indexer.
  await baseA.append({ op: 'addWriter', addWriter: b4a.toString(baseB.local.key, 'hex') })
  console.log('[A] sent addWriter(B)')

  // B is not writable until it has applied A's addWriter op.
  await waitFor(async () => {
    await baseB.update()
    return baseB.writable
  }, 'B to become writable')
  console.log('[B] became writable')

  // Both devices write concurrently.
  await baseA.append({ op: 'put', path: '/from-a.txt', content: 'hello from device A' })
  console.log('[A] wrote /from-a.txt')
  await baseB.append({ op: 'put', path: '/from-b.txt', content: 'hello from device B' })
  console.log('[B] wrote /from-b.txt')

  // Convergence: each side must see both files.
  await waitFor(async () => {
    await baseA.update()
    return (await baseA.view.get('/from-a.txt')) !== null && (await baseA.view.get('/from-b.txt')) !== null
  }, 'device A to converge')
  await waitFor(async () => {
    await baseB.update()
    return (await baseB.view.get('/from-a.txt')) !== null && (await baseB.view.get('/from-b.txt')) !== null
  }, 'device B to converge')

  for (const [label, view] of [['A', baseA.view], ['B', baseB.view]] as const) {
    console.log(`--- device ${label} view ---`)
    for await (const { key, value } of view.createReadStream()) {
      console.log('  ', key, '=', b4a.toString(value))
    }
  }

  console.log('\n✅ multi-writer convergence verified')
  await baseA.close()
  await baseB.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
