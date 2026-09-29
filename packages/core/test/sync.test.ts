// Two-engine integration tests over a local DHT testnet. These capture the
// behaviors previously verified only by hand (see PLAN.md Phase 1–3 notes).

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import {
  Harness,
  listFiles,
  readFile,
  sleep,
  waitFor,
  waitForFile,
  waitForGone,
  writeFile,
  type TestDevice
} from './helpers'

let h: Harness

before(async () => {
  h = await Harness.create()
})

after(async () => {
  await h.destroy()
})

// One drive with two live devices, reused by the tests below in order.
let a: TestDevice
let b: TestDevice

async function bothIdle (): Promise<void> {
  await waitFor(
    () => a.engine.status === 'idle' && b.engine.status === 'idle',
    'both engines idle'
  )
}

test('create + pair: files sync both ways', async () => {
  a = await h.createDevice()
  writeFile(a.syncDir, 'hello.txt', 'from A')

  assert.ok(a.engine.baseKey, 'bootstrap device has a drive key')
  b = await h.pairDevice(a.engine.baseKey!)

  await waitForFile(b.syncDir, 'hello.txt', 'from A')
  await waitFor(() => b.engine.listDevices().length === 2, 'B to see both writers')
  await waitFor(() => a.engine.listDevices().length === 2, 'A to see both writers')

  writeFile(b.syncDir, 'reply.txt', 'from B')
  await waitForFile(a.syncDir, 'reply.txt', 'from B')

  // A paired device has no recovery phrase of its own.
  assert.equal(b.engine.phrase, null)
  assert.equal(b.engine.baseKey, a.engine.baseKey)
})

test('nested paths sync', async () => {
  writeFile(a.syncDir, 'docs/notes/deep.txt', 'nested')
  await waitForFile(b.syncDir, 'docs/notes/deep.txt', 'nested')
})

test('sequential cross-device edit does not create a conflict', async () => {
  writeFile(a.syncDir, 'seq.txt', 'v1')
  await waitForFile(b.syncDir, 'seq.txt', 'v1')

  writeFile(b.syncDir, 'seq.txt', 'v2')
  await waitForFile(a.syncDir, 'seq.txt', 'v2')
  await bothIdle()

  const conflicts = listFiles(a.syncDir).filter(f => f.includes('conflicted copy'))
  assert.deepEqual(conflicts, [], 'no conflicted copies for a sequential edit')
})

test('concurrent edit archives a conflicted copy on both sides', async () => {
  writeFile(a.syncDir, 'clash.txt', 'base')
  await waitForFile(b.syncDir, 'clash.txt', 'base')
  await bothIdle()

  // Cut connectivity so neither sees the other's edit before making its own.
  await a.engine.suspend()
  await b.engine.suspend()
  writeFile(a.syncDir, 'clash.txt', 'edit from A')
  writeFile(b.syncDir, 'clash.txt', 'edit from B')
  await sleep(500) // let both edits land in the local logs while offline
  await a.engine.resume()
  await b.engine.resume()

  // Both sides converge: one version wins at clash.txt, the loser is archived.
  await waitFor(() => {
    const filesA = listFiles(a.syncDir)
    const filesB = listFiles(b.syncDir)
    const conflictA = filesA.find(f => f.startsWith('clash') && f.includes('conflicted copy'))
    const conflictB = filesB.find(f => f.startsWith('clash') && f.includes('conflicted copy'))
    if (!conflictA || conflictA !== conflictB) return false
    const winnerA = readFile(a.syncDir, 'clash.txt')
    const winnerB = readFile(b.syncDir, 'clash.txt')
    const loserA = readFile(a.syncDir, conflictA)
    const loserB = readFile(b.syncDir, conflictB)
    if (!winnerA || !winnerB || !loserA || !loserB) return false
    if (!winnerA.equals(winnerB) || !loserA.equals(loserB)) return false
    // Between winner and loser, both edits survived.
    const texts = [winnerA.toString(), loserA.toString()].sort()
    return texts[0] === 'edit from A' && texts[1] === 'edit from B'
  }, 'conflicted copy to converge on both sides')
})

test('delete propagates', async () => {
  writeFile(a.syncDir, 'doomed.txt', 'bye')
  await waitForFile(b.syncDir, 'doomed.txt', 'bye')
  await bothIdle()

  const { unlinkSync } = await import('node:fs')
  unlinkSync(`${a.syncDir}/doomed.txt`)
  await waitForGone(b.syncDir, 'doomed.txt')
})

test('restart: no spurious re-sync or conflicts from the initial scan', async () => {
  writeFile(a.syncDir, 'stable.txt', 'unchanged')
  await waitForFile(b.syncDir, 'stable.txt', 'unchanged')
  await bothIdle()

  b = await h.reopenDevice(await stopped(b))
  // The reopened engine's initial chokidar scan re-reports every file; none
  // of them changed, so nothing must be re-written or conflicted.
  await waitFor(() => b.engine.status !== 'syncing' && b.engine.peers > 0, 'B back online')
  await sleep(1000)

  assert.deepEqual(
    listFiles(b.syncDir).filter(f => f.includes('conflicted copy') && f.startsWith('stable')),
    []
  )
  assert.equal(readFile(b.syncDir, 'stable.txt')!.toString(), 'unchanged')

  async function stopped (d: TestDevice): Promise<TestDevice> {
    await h.stopDevice(d)
    return d
  }
})

test('restore from recovery phrase becomes a working device', async () => {
  writeFile(a.syncDir, 'legacy.txt', 'restore me')
  assert.ok(a.engine.phrase, 'bootstrap device holds the phrase')

  const c = await h.restoreDevice(a.engine.phrase!)
  await waitForFile(c.syncDir, 'legacy.txt', 'restore me')

  // A restored device is a phrase-holding device with the same drive key.
  assert.equal(c.engine.phrase, a.engine.phrase)
  assert.equal(c.engine.baseKey, a.engine.baseKey)

  // And it can write.
  writeFile(c.syncDir, 'from-restored.txt', 'hi')
  await waitForFile(a.syncDir, 'from-restored.txt', 'hi')

  await h.stopDevice(c)
})

test('pairing with identical pre-existing files creates no conflicts', async () => {
  const a2 = await h.createDevice()
  writeFile(a2.syncDir, 'same.txt', 'identical bytes')

  // Identical file already in the joining folder: no conflicted copy.
  const b2 = await h.pairDevice(a2.engine.baseKey!, undefined, { 'same.txt': 'identical bytes' })
  await waitFor(() => b2.engine.listDevices().length === 2, 'pairing to settle')
  await sleep(1500)

  for (const d of [a2, b2]) {
    assert.deepEqual(listFiles(d.syncDir).filter(f => f.includes('conflicted copy')), [])
    assert.equal(readFile(d.syncDir, 'same.txt')!.toString(), 'identical bytes')
  }
  await h.stopDevice(a2)
  await h.stopDevice(b2)
})

test('OS junk files are not synced', async () => {
  writeFile(a.syncDir, '.DS_Store', 'finder junk')
  writeFile(a.syncDir, 'marker.txt', 'after junk')
  await waitForFile(b.syncDir, 'marker.txt', 'after junk')
  await sleep(500)
  assert.equal(readFile(b.syncDir, '.DS_Store'), null)
})

test('revoke: self-revoke rejected; revoked device drops from both lists', async () => {
  const localKey = a.engine.listDevices().find(d => d.isLocal)!.key
  await assert.rejects(a.engine.revokeDevice(localKey), /cannot revoke this device/)

  const target = a.engine.listDevices().find(d => !d.isLocal)
  assert.ok(target, 'A sees a linked device to revoke')
  await a.engine.revokeDevice(target!.key)

  await waitFor(
    () => !a.engine.listDevices().some(d => d.key === target!.key),
    'A to drop the revoked device'
  )
  await waitFor(
    () => !b.engine.listDevices().some(d => d.key === target!.key),
    "B to drop its own revoked writer entry"
  )
})
