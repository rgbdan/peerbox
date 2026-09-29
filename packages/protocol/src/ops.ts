// Filesystem ops shared by every device. No Node/React Native imports: runs in both.

export interface BlobId {
  byteOffset: number
  blockOffset: number
  blockLength: number
  byteLength: number
}

export interface BlobRef {
  device: string // hex: writer core key that owns the blob bytes
  id: BlobId // position within that device's blobs core
  size?: number // content length in bytes (absent on legacy entries)
  hash?: string // hex sha256 of the content (absent on legacy entries)
}

/** Version this put supersedes, to tell edits from conflicts; `null` for a new file. */
export interface BasedOn {
  device: string
  seq: number
}

export interface PutOp {
  op: 'put'
  path: string
  blob: BlobRef
  basedOn: BasedOn | null
}

export interface DelOp {
  op: 'del'
  path: string
}

export interface AddWriterOp {
  op: 'addWriter'
  addWriter: string // hex: device writer core key being authorized
  sig: string // hex: root-authority signature over `addWriter`
}

export type Op = PutOp | DelOp | AddWriterOp

/** Normalize to an absolute unix path without a trailing slash. */
export function normalizePath (input: string): string {
  return '/' + input.split('/').filter(Boolean).join('/')
}
