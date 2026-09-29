// Large-file behavior: streaming transfer, atomic writes (no partially
// visible files), and in-progress copies not being snapshotted early.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomBytes, createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { join } from 'node:path'
import {
  Harness,
  listFiles,
  readFile,
  sleep,
  waitFor,
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
  // Wait until the pair handshake settles before the tests start writing.
  writeFile(a.syncDir, 'warmup.txt', 'ready')
  await waitFor(() => readFile(b.syncDir, 'warmup.txt') !== null, 'pairing to settle')
})

after(async () => {
  await h.destroy()
})

function sha256 (buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

test('a large file syncs intact', async () => {
  const big = randomBytes(16 * 1024 * 1024) // 16 MB of incompressible bytes
  writeFile(a.syncDir, 'big.bin', big)

  await waitFor(() => {
    const got = readFile(b.syncDir, 'big.bin')
    return got !== null && got.length === big.length && sha256(got) === sha256(big)
  }, 'big.bin to arrive intact on B', 60_000)

  // No temp-file litter left behind on either side.
  assert.deepEqual(listFiles(a.syncDir).filter(f => f.includes('.peerbox-tmp')), [])
  assert.deepEqual(listFiles(b.syncDir).filter(f => f.includes('.peerbox-tmp')), [])
})

test('an edited large file syncs the new content', async () => {
  const edited = randomBytes(4 * 1024 * 1024)
  writeFile(a.syncDir, 'big.bin', edited)

  await waitFor(() => {
    const got = readFile(b.syncDir, 'big.bin')
    return got !== null && got.length === edited.length && sha256(got) === sha256(edited)
  }, 'edited big.bin to arrive on B', 60_000)

  // A sequential edit of a large file must not conflict.
  const conflicts = listFiles(b.syncDir).filter(f => f.startsWith('big') && f.includes('conflicted copy'))
  assert.deepEqual(conflicts, [])
})

test('a file still being written is not synced truncated', async () => {
  // Slow copy: gaps under the 500ms stability threshold, so upload only once done.
  const slow = await h.createDevice({ watchStabilityMs: 500 })
  const sink = await h.pairDevice(slow.engine.baseKey!, { watchStabilityMs: 500 })

  const chunks = Array.from({ length: 8 }, () => randomBytes(256 * 1024))
  const full = Buffer.concat(chunks)
  const out = createWriteStream(join(slow.syncDir, 'copying.bin'))
  for (const chunk of chunks) {
    out.write(chunk)
    await sleep(150)
  }
  await new Promise<void>((resolve, reject) => out.end((err: Error | null | undefined) => err ? reject(err) : resolve()))

  await waitFor(() => {
    const got = readFile(sink.syncDir, 'copying.bin')
    // Atomic rename on the receiving side: the file either doesn't exist yet
    // or is complete — a truncated version must never appear.
    if (got !== null && got.length !== full.length) {
      throw new Error(`truncated sync: got ${got.length} of ${full.length} bytes`)
    }
    return got !== null && sha256(got) === sha256(full)
  }, 'slow-copied file to arrive complete', 60_000)

  await h.stopDevice(slow)
  await h.stopDevice(sink)
})
