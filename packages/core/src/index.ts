/// <reference path="./types.d.ts" />

// Public surface of @peerbox/core; hosts import only this module.

export { Engine } from './engine'
export type { DeviceInfo, EngineStatus } from './engine'
export { configDir, loadIdentity } from './identity'
export { loadSyncDir } from './config'
