// Minimal ambient declarations for the CJS Holepunch modules (no bundled types).
declare module 'corestore' {
  const Corestore: any
  export = Corestore
}
declare module 'autobase' {
  const Autobase: any
  export = Autobase
}
declare module 'hyperbee' {
  const Hyperbee: any
  export = Hyperbee
}
declare module 'hyperblobs' {
  const Hyperblobs: any
  export = Hyperblobs
}
declare module 'hypercore' {
  const Hypercore: any
  export = Hypercore
}
declare module 'hyperswarm' {
  const Hyperswarm: any
  export = Hyperswarm
}
declare module 'hypercore-crypto' {
  const crypto: any
  export = crypto
}
declare module 'b4a' {
  const b4a: any
  export = b4a
}
declare module 'hyperdht/testnet' {
  const createTestnet: any
  export = createTestnet
}
declare module 'streamx' {
  export const pipelinePromise: (...streams: any[]) => Promise<void>
}
