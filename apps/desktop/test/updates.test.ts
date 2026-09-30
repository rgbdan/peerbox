import { test } from 'node:test'
import assert from 'node:assert/strict'
import { UpdateChecker, fetchLatestVersion, isNewer } from '../src/engine/updates'

test('isNewer compares numerically and ignores malformed versions', () => {
  assert.equal(isNewer('0.1.2', '0.1.1'), true)
  assert.equal(isNewer('0.1.10', '0.1.9'), true)
  assert.equal(isNewer('v1.0.0', '0.9.9'), true)
  assert.equal(isNewer('0.1.1', '0.1.1'), false)
  assert.equal(isNewer('0.1.0', '0.1.1'), false)
  assert.equal(isNewer('0.2.0-beta.1', '0.1.1'), false)
  assert.equal(isNewer('0.2.0', ''), false)
})

test('nothing is fetched until check() is called', () => {
  let calls = 0
  const checker = new UpdateChecker('0.1.1', async () => { calls++; return '0.2.0' })
  assert.equal(calls, 0)
  assert.equal(checker.state.latest, null)
  assert.equal(checker.state.checkedAt, null)
})

test('a check reports a newer release and emits it', async () => {
  const checker = new UpdateChecker('0.1.1', async () => '0.2.0')
  const emitted: unknown[] = []
  checker.on('update', (state) => emitted.push(state))
  const state = await checker.check()
  assert.equal(state.latest, '0.2.0')
  assert.equal(state.available, true)
  assert.deepEqual(emitted, [state])
})

test('a failed check reports the error', async () => {
  const checker = new UpdateChecker('0.1.1', async () => { throw new Error('offline') })
  const state = await checker.check()
  assert.equal(state.error, 'offline')
  assert.equal(state.available, false)
  assert.notEqual(state.checkedAt, null)
})

test('fetchLatestVersion reads the tag from the /releases/latest redirect', async (t) => {
  const redirect = (location: string): Response =>
    new Response(null, { status: 302, headers: { location } })

  t.mock.method(globalThis, 'fetch', async () => redirect('https://github.com/rgbdan/peerbox/releases/tag/v0.1.2'))
  assert.equal(await fetchLatestVersion(), '0.1.2')

  // No releases: GitHub redirects to the list instead of a tag.
  t.mock.method(globalThis, 'fetch', async () => redirect('https://github.com/rgbdan/peerbox/releases'))
  await assert.rejects(fetchLatestVersion(), /no published release/)
})
