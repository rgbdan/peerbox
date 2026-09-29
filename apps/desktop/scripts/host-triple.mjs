import { execFileSync } from 'node:child_process'

/** Rust host target triple, e.g. x86_64-unknown-linux-gnu. */
export function hostTriple () {
  return execFileSync('rustc', ['-vV'], { encoding: 'utf8' })
    .split('\n')
    .find((line) => line.startsWith('host:'))
    .split(':')[1]
    .trim()
}
