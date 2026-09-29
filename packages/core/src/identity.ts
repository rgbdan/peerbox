// Device identity: phrase -> BIP39 seed -> bootstrap keypair (deterministic
// drive key) and an authority keypair that signs optimistic addWriter ops.
// Model and rationale: PLAN.md.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import crypto from 'hypercore-crypto'
import b4a from 'b4a'
import { recovery } from '@peerbox/protocol'

export interface KeyPair {
  publicKey: Buffer
  secretKey: Buffer
}

export interface Identity {
  phrase: string | null // recovery phrase (bootstrap/restore devices only)
  baseKey: string | null // hex: drive key (null until setup completes)
  isBootstrap: boolean // true for the device that created the drive
}

interface StoredIdentity {
  version: 1
  phrase: string | null
  baseKey: string | null
  isBootstrap: boolean
}

export function configDir (): string {
  return process.env.PEERBOX_CONFIG_DIR || join(homedir(), '.config', 'peerbox')
}

function identityPath (dir: string): string {
  return join(dir, 'identity.json')
}

/** Load the persisted identity, or null if this device is not set up yet. */
export function loadIdentity (dir: string = configDir()): Identity | null {
  const file = identityPath(dir)
  if (!existsSync(file)) return null
  const stored = JSON.parse(readFileSync(file, 'utf8')) as StoredIdentity
  return {
    phrase: stored.phrase,
    baseKey: stored.baseKey,
    isBootstrap: stored.isBootstrap
  }
}

export function saveIdentity (identity: Identity, dir: string = configDir()): void {
  mkdirSync(dir, { recursive: true })
  const stored: StoredIdentity = {
    version: 1,
    phrase: identity.phrase,
    baseKey: identity.baseKey,
    isBootstrap: identity.isBootstrap
  }
  writeFileSync(identityPath(dir), JSON.stringify(stored, null, 2))
}

/** Fresh identity for the first device (new phrase, bootstraps a new drive). */
export function createIdentity (): Identity {
  return {
    phrase: recovery.generate(),
    baseKey: null,
    isBootstrap: true
  }
}

/** Restore an identity from a typed recovery phrase (joins the drive). */
export function restoreIdentity (phrase: string): Identity {
  return {
    phrase: recovery.parse(phrase).join(' '),
    baseKey: null,
    isBootstrap: false
  }
}

/** Identity for a device paired via QR/short-code (drive key, no phrase). */
export function pairIdentity (baseKey: string): Identity {
  return {
    phrase: null,
    baseKey,
    isBootstrap: false
  }
}

/** The deterministic root keypair derived from the recovery phrase. */
export function bootstrapKeyPair (phrase: string): KeyPair {
  const seed = recovery.toSeed(recovery.parse(phrase)).subarray(0, 32)
  return crypto.keyPair(seed)
}

/** The signing authority, derived from (and only from) the drive key. */
export function authorityKeyPair (baseKey: string): KeyPair {
  return crypto.keyPair(crypto.hash(b4a.from(baseKey, 'hex')))
}

/** Sign a device writer key with the authority so peers can verify it. */
export function signAddWriter (baseKey: string, deviceWriterKey: Buffer): string {
  const sig = crypto.sign(deviceWriterKey, authorityKeyPair(baseKey).secretKey)
  return sig.toString('hex')
}

// Prefixed with the op name (unlike signAddWriter's raw key) so an addWriter
// signature can never be replayed as a removeWriter one, or vice versa.
export function signRemoveWriter (baseKey: string, deviceWriterKey: Buffer): string {
  const message = b4a.concat([b4a.from('removeWriter'), deviceWriterKey])
  const sig = crypto.sign(message, authorityKeyPair(baseKey).secretKey)
  return sig.toString('hex')
}

/** Short human-readable label for a device, used in conflicted-copy names. */
export function deviceLabel (deviceWriterKey: string | Buffer): string {
  const hex = typeof deviceWriterKey === 'string' ? deviceWriterKey : deviceWriterKey.toString('hex')
  return hex.slice(0, 8)
}
