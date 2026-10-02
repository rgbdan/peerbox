import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import type { DeviceInfo } from '@peerbox/core'
import { encodePairing } from '@peerbox/protocol'
import type { StatusUpdate, UpdateState } from '../shared/app-state'

interface Props {
  initial: StatusUpdate
  baseKey: string
  syncDir: string
  hasPhrase: boolean
  autostartEnabled: boolean
}

export function Status ({ initial, baseKey, syncDir, hasPhrase, autostartEnabled }: Props) {
  const [live, setLive] = useState<StatusUpdate>(initial)
  const [retrying, setRetrying] = useState(false)
  const [copied, setCopied] = useState(false)
  const [quitting, setQuitting] = useState(false)
  const [phrase, setPhrase] = useState<string | undefined>(undefined)
  const [revealing, setRevealing] = useState(false)
  const [changingFolder, setChangingFolder] = useState(false)
  const [qr, setQr] = useState<string | null>(null)
  const [togglingAutostart, setTogglingAutostart] = useState(false)
  const [devices, setDevices] = useState<DeviceInfo[]>([])
  const [revokingKey, setRevokingKey] = useState<string | null>(null)
  const [update, setUpdate] = useState<UpdateState | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    window.peerbox.getUpdateState().then(setUpdate).catch(() => {})
    window.peerbox.onUpdate(setUpdate)
    const refreshDevices = (): void => { window.peerbox.listDevices().then(setDevices).catch(() => {}) }
    refreshDevices()
    // A status pushed before this view mounted (right after setup) reached
    // nobody, so re-read rather than trusting `initial`.
    window.peerbox.getState().then((s) => { if (s.view === 'status') setLive(s) }).catch(() => {})
    window.peerbox.onStatus((next) => {
      setLive(next)
      refreshDevices()
    })
  }, [])

  async function retry (): Promise<void> {
    setRetrying(true)
    try {
      await window.peerbox.retry()
    } finally {
      setRetrying(false)
    }
  }

  async function revokeDevice (d: DeviceInfo): Promise<void> {
    if (!window.confirm(
      `Revoke ${d.label}? It will stop syncing new changes, but this does not ` +
      'erase files it already has, and it may be able to rejoin later. This ' +
      'cannot be undone from here.'
    )) return
    setRevokingKey(d.key)
    try {
      await window.peerbox.revokeDevice(d.key)
      setDevices(await window.peerbox.listDevices())
    } finally {
      setRevokingKey(null)
    }
  }

  useEffect(() => {
    const payload = encodePairing({ v: 1, kind: 'join', base: baseKey })
    QRCode.toDataURL(payload, { margin: 1, width: 200 }).then(setQr).catch(() => setQr(null))
  }, [baseKey])

  async function copyKey (): Promise<void> {
    await navigator.clipboard.writeText(baseKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function quit (): void {
    setQuitting(true)
    window.peerbox.quit()
  }

  async function changeFolder (): Promise<void> {
    setChangingFolder(true)
    try {
      await window.peerbox.changeFolder()
    } finally {
      setChangingFolder(false)
    }
  }

  async function toggleAutostart (): Promise<void> {
    setTogglingAutostart(true)
    try {
      await window.peerbox.setAutostart(!autostartEnabled)
    } finally {
      setTogglingAutostart(false)
    }
  }

  async function checkNow (): Promise<void> {
    setChecking(true)
    try {
      setUpdate(await window.peerbox.checkForUpdates())
    } finally {
      setChecking(false)
    }
  }

  async function reveal (): Promise<void> {
    setRevealing(true)
    try {
      const result = await window.peerbox.getPhrase()
      if (result) setPhrase(result)
    } finally {
      setRevealing(false)
    }
  }

  const beaconState =
    live.status === 'syncing' ? 'active'
      : live.status === 'waiting' ? 'waiting'
        : live.status === 'error' ? 'error'
          : 'idle'
  const pillState = beaconState === 'idle' ? '' : beaconState

  // Other devices only. `peers` is just a count: swarm keys don't map to writer keys.
  const self = devices.find((d) => d.isLocal)
  const others = devices.filter((d) => !d.isLocal)
  const summary = others.length === 0
    ? 'no other devices linked yet'
    : `${live.peers} of ${others.length} connected right now`

  return (
    <div>
      <div className="topbar">
        <div className="brand">
          <span className={`beacon ${beaconState}`} />
          <span className="wordmark">peerbox</span>
        </div>
        <span className={`pill ${pillState}`}>{live.label}</span>
      </div>
      <p className="path hint">{syncDir}</p>

      {live.error !== null && (
        <div className="error error-banner">
          <span>{live.error}</span>
          <button type="button" onClick={() => { void retry() }} disabled={retrying}>
            {retrying ? 'Retrying…' : 'Retry'}
          </button>
        </div>
      )}

      <div className="actions">
        <button type="button" onClick={window.peerbox.openFolder}>Open folder</button>
        {hasPhrase && (
          <button type="button" onClick={changeFolder} disabled={changingFolder}>
            {changingFolder ? 'Changing…' : 'Change folder…'}
          </button>
        )}
        <button type="button" onClick={quit} disabled={quitting}>
          {quitting ? 'Quitting…' : 'Quit peerbox'}
        </button>
      </div>

      <label className={`checkbox-row${togglingAutostart ? ' disabled' : ''}`}>
        <input
          type="checkbox"
          checked={autostartEnabled}
          disabled={togglingAutostart}
          onChange={() => { void toggleAutostart() }}
        />
        Start peerbox on login
      </label>

      <h1 className="section">Link new device</h1>
      <div className="pairing-panel">
        {qr
          ? <img className="qr" src={qr} alt="Pairing QR code" width={92} height={92} />
          : <div className="qr-placeholder" aria-hidden="true" />}
        <div className="pairing-body">
          <p className="hint">
            Scan this QR with peerbox on the other device, or paste the key
            into &quot;Link this device&quot; on its setup screen.
          </p>
          <div className="row">
            <input value={baseKey} readOnly onFocus={(e) => e.target.select()} />
            <button type="button" onClick={copyKey}>{copied ? 'Copied!' : 'Copy key'}</button>
          </div>
        </div>
      </div>

      <h1 className="section">Linked devices ({others.length})</h1>
      <p className="hint">
        {self ? `This device is ${self.label} · ${summary}.` : `${summary[0].toUpperCase()}${summary.slice(1)}.`}
      </p>
      <ul className="devices">
        {others.map((d) => (
          <li key={d.key}>
            <span className="device-name">
              <span className="dot" aria-hidden="true" />
              <span>{d.label}</span>
            </span>
            {hasPhrase && (
              <button
                type="button"
                className="revoke"
                onClick={() => { void revokeDevice(d) }}
                disabled={revokingKey === d.key}
              >
                {revokingKey === d.key ? 'Revoking…' : 'Revoke'}
              </button>
            )}
          </li>
        ))}
      </ul>
      {hasPhrase && (
        <>
          <h1 className="section">Recovery phrase</h1>
          {phrase === undefined && (
            <>
              <p className="hint">
                Anyone with this phrase can access all your files. Only
                reveal it somewhere private.
              </p>
              <button type="button" onClick={reveal} disabled={revealing}>
                {revealing ? 'Revealing…' : 'Reveal phrase'}
              </button>
            </>
          )}
          {phrase !== undefined && (
            <>
              <p className="phrase">{phrase}</p>
              <button type="button" onClick={() => setPhrase(undefined)}>Hide</button>
            </>
          )}
        </>
      )}

      {update && (
        <>
          <h1 className="section">
            Version
            {update.current !== '' && <span className="section-detail">v{update.current}</span>}
          </h1>
          <p className="hint">
            peerbox never checks for updates on its own. Check now asks GitHub
            for the latest version; GitHub sees your IP address, nothing else
            is sent.
          </p>
          <div className="actions">
            <button type="button" onClick={() => { void checkNow() }} disabled={checking}>
              {checking ? 'Checking…' : 'Check now'}
            </button>
          </div>
          {!checking && update.checkedAt !== null && (
            update.error !== null
              ? <p className="hint">Couldn’t check for updates: {update.error}.</p>
              : update.available
                ? (
                  <div className="update-banner">
                    <span>peerbox v{update.latest} is available.</span>
                    <button type="button" onClick={window.peerbox.openDownload}>Download</button>
                  </div>
                  )
                : <p className="hint">You’re on the latest version.</p>
          )}
        </>
      )}
    </div>
  )
}
