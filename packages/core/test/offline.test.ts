// Changes made while a device's engine was stopped: they must be reconciled on
// restart, not undone by the download pass or the initial disk scan.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { Engine } from '../src/engine'
import {
  Harness,
  readFile,
  sleep,
  waitFor,
  waitForFile,
  waitForGone,
  writeFile,
  type TestDevice
} from './helpers'

let h: Harness
let a: TestDevice
let b: TestDevice

before(async () => {
  h = await Harness.create()
  a = await h.createDevice()
  b = await h.pairDevice(a.engine.baseKey!)
  await waitFor(() => a.engine.listDevices().length === 2 && b.engine.listDevices().length === 2, 'pairing')
})

after(async () => {
  await h.destroy()
})

async function settled (...devices: TestDevice[]): Promise<void> {
  await waitFor(() => devices.every(d => d.engine.status !== 'syncing'), 'engines to settle')
  // Let the debounce + watcher stability window pass.
  await sleep(500)
}

async function restartB (change: () => void): Promise<void> {
  await h.stopDevice(b)
  change()
  b = await h.reopenDevice(b)
  await waitFor(() => b.engine.peers > 0, 'B to reconnect')
  await settled(a, b)
}

test('a file deleted while the engine was stopped is deleted everywhere', async () => {
  // Another file stays, or the empty folder would read as unmounted (below).
  writeFile(a.syncDir, 'stays.txt', 'still here')
  writeFile(a.syncDir, 'offline-del.txt', 'delete me offline')
  await waitForFile(b.syncDir, 'stays.txt', 'still here')
  await waitForFile(b.syncDir, 'offline-del.txt', 'delete me offline')
  await settled(a, b)

  await restartB(() => unlinkSync(join(b.syncDir, 'offline-del.txt')))

  await waitForGone(a.syncDir, 'offline-del.txt')
  assert.equal(readFile(b.syncDir, 'offline-del.txt'), null)
})

test('a file deleted elsewhere while this device was stopped is not re-uploaded', async () => {
  writeFile(a.syncDir, 'remote-del.txt', 'deleted on A')
  await waitForFile(b.syncDir, 'remote-del.txt', 'deleted on A')
  await settled(a, b)

  await h.stopDevice(b)
  unlinkSync(join(a.syncDir, 'remote-del.txt'))
  await settled(a)
  b = await h.reopenDevice(b)
  await waitFor(() => b.engine.peers > 0, 'B to reconnect')

  await waitForGone(b.syncDir, 'remote-del.txt')
  await settled(a, b)
  assert.equal(readFile(a.syncDir, 'remote-del.txt'), null)
})

test('an emptied sync folder is restored, not treated as a mass delete', async () => {
  writeFile(a.syncDir, 'keep-1.txt', 'one')
  writeFile(a.syncDir, 'keep-2.txt', 'two')
  await waitForFile(b.syncDir, 'keep-1.txt', 'one')
  await waitForFile(b.syncDir, 'keep-2.txt', 'two')
  await settled(a, b)

  // E.g. an external drive that isn't mounted: the folder is there but empty.
  await restartB(() => {
    rmSync(b.syncDir, { recursive: true, force: true })
    mkdirSync(b.syncDir)
  })

  await waitForFile(b.syncDir, 'keep-1.txt', 'one')
  await waitForFile(b.syncDir, 'keep-2.txt', 'two')
  assert.equal(readFile(a.syncDir, 'keep-1.txt')!.toString(), 'one')
})

test('switching to a new empty folder downloads everything and deletes nothing', async () => {
  writeFile(a.syncDir, 'moved.txt', 'follow me')
  await waitForFile(b.syncDir, 'moved.txt', 'follow me')
  await settled(a, b)

  await h.stopDevice(b)
  const newDir = b.syncDir + '-new'
  mkdirSync(newDir)
  const engine = await Engine.open(newDir, b.configDir, { bootstrap: h.bootstrap, debounceMs: 50, watchStabilityMs: 150 })
  try {
    await waitForFile(newDir, 'moved.txt', 'follow me')
    await sleep(1000)
    assert.equal(readFile(a.syncDir, 'moved.txt')!.toString(), 'follow me')
  } finally {
    await engine.stop()
  }
})
