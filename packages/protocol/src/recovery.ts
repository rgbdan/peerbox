// Recovery phrase: 12-word BIP39 mnemonic -> 64-byte seed. Pure JS so it runs
// on both Node and React Native.

import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'

/** Generate a new 12-word recovery phrase. */
export function generate (): string {
  return generateMnemonic(wordlist, 128)
}

/** Derive the 64-byte BIP39 seed from a recovery phrase. */
export function toSeed (words: string[]): Uint8Array {
  const mnemonic = words.join(' ')
  if (!validateMnemonic(mnemonic, wordlist)) throw new Error('Invalid recovery phrase')
  return mnemonicToSeedSync(mnemonic, '')
}

/** Split and normalize a user-typed phrase into words. */
export function parse (phrase: string): string[] {
  return phrase.trim().toLowerCase().split(/\s+/).filter(Boolean)
}
