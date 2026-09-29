import { useEffect, useState } from 'react'
import type { AppState } from '../shared/app-state'
import { Setup } from './Setup'
import { Status } from './Status'

export function App () {
  const [state, setState] = useState<AppState | null>(null)
  const refresh = (): void => { void window.peerbox.getState().then(setState) }

  useEffect(() => {
    refresh()
    window.peerbox.onStateChanged(refresh)
  }, [])

  if (!state) return null

  if (state.view === 'setup') {
    return <Setup defaultDir={state.defaultDir} onCreated={refresh} />
  }

  return (
    <Status
      initial={{ status: state.status, label: state.label, peers: state.peers, error: state.error }}
      baseKey={state.baseKey}
      syncDir={state.syncDir}
      hasPhrase={state.hasPhrase}
      autostartEnabled={state.autostartEnabled}
    />
  )
}
