// Conflict rule: the linearized winner stays, the loser is kept as
// "name (conflicted copy from <device>).ext".

export function conflictedName (path: string, device: string): string {
  return taggedName(path, `(conflicted copy from ${device})`)
}

export function numberedConflictName (path: string, device: string, i: number): string {
  return taggedName(path, `(conflicted copy ${i} from ${device})`)
}

// Insert the tag before the extension. A leading dot (".DS_Store") is a
// hidden-file marker, not an extension separator.
function taggedName (path: string, tag: string): string {
  const slash = path.lastIndexOf('/')
  const dot = path.lastIndexOf('.')
  const hasExt = dot > slash + 1
  const base = hasExt ? path.slice(0, dot) : path
  const ext = hasExt ? path.slice(dot) : ''
  return `${base} ${tag}${ext}`
}

// Junk files the OS drops everywhere; never synced in either direction.
const IGNORED_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])

export function isIgnoredFile (path: string): boolean {
  const name = path.slice(path.lastIndexOf('/') + 1)
  return IGNORED_NAMES.has(name)
}
