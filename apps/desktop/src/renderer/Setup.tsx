import { useState } from 'react'

interface Props {
  defaultDir: string
  onCreated: () => void
}

type Mode = 'create' | 'join' | 'restore'

type Step =
  | { kind: 'form' }
  | { kind: 'phrase', phrase: string }

export function Setup ({ defaultDir, onCreated }: Props) {
  const [mode, setMode] = useState<Mode>('create')
  const [dir, setDir] = useState(defaultDir)
  const [baseKey, setBaseKey] = useState('')
  const [phrase, setPhrase] = useState('')
  const [step, setStep] = useState<Step>({ kind: 'form' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function browse (): Promise<void> {
    const picked = await window.peerbox.chooseFolder()
    if (picked) setDir(picked)
  }

  async function run (action: () => Promise<void>): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const create = () => run(async () => {
    const result = await window.peerbox.createDrive(dir)
    setStep({ kind: 'phrase', phrase: result.phrase })
  })
  const join = () => run(async () => {
    await window.peerbox.joinDrive(baseKey.trim(), dir)
    onCreated()
  })
  const restore = () => run(async () => {
    await window.peerbox.restoreDrive(phrase.trim().toLowerCase(), dir)
    onCreated()
  })

  if (step.kind === 'phrase') {
    return (
      <div>
        <p className="phrase-heading">✓ Drive created</p>
        <h1 className="wordmark" style={{ marginBottom: 8 }}>Save your recovery phrase</h1>
        <p className="hint">
          This is the only way to restore your drive on another device. Write
          it down and keep it somewhere safe — peerbox cannot recover it for
          you.
        </p>
        <p className="phrase">{step.phrase}</p>
        <button type="button" className="primary setup-cta" onClick={onCreated}>
          I&apos;ve saved it — Continue
        </button>
      </div>
    )
  }

  return (
    <div>
      <div className="brandmark">
        <span className="beacon" />
        <span className="wordmark">peerbox</span>
      </div>
      <p className="tagline">Private sync between your own devices. No cloud, no accounts.</p>

      <div className="segmented">
        <button
          type="button"
          aria-pressed={mode === 'create'}
          onClick={() => setMode('create')}
        >
          New drive
        </button>
        <button
          type="button"
          aria-pressed={mode === 'join'}
          onClick={() => setMode('join')}
        >
          Link device
        </button>
        <button
          type="button"
          aria-pressed={mode === 'restore'}
          onClick={() => setMode('restore')}
        >
          Restore
        </button>
      </div>

      {mode === 'join' && (
        <>
          <p className="hint">Paste the drive key shown on your other device.</p>
          <div className="row">
            <input value={baseKey} onChange={(e) => setBaseKey(e.target.value)} placeholder="drive key" />
          </div>
        </>
      )}

      {mode === 'restore' && (
        <>
          <p className="hint">
            Enter your 12-word recovery phrase. This device becomes your main
            device again and pulls your files from any device that's online.
          </p>
          <div className="row">
            <textarea
              className="phrase-input"
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              placeholder="alpha bravo charlie …"
              rows={3}
              spellCheck={false}
            />
          </div>
        </>
      )}

      <span className="field-label">Sync folder</span>
      <div className="row">
        <input value={dir} onChange={(e) => setDir(e.target.value)} />
        <button type="button" onClick={browse}>Browse…</button>
      </div>
      {error && <p className="error">{error}</p>}
      {mode === 'create' && (
        <button type="button" className="primary setup-cta" onClick={create} disabled={busy || !dir}>
          {busy ? 'Creating…' : 'Create drive'}
        </button>
      )}
      {mode === 'join' && (
        <button type="button" className="primary setup-cta" onClick={join} disabled={busy || !dir || !baseKey.trim()}>
          {busy ? 'Linking…' : 'Link device'}
        </button>
      )}
      {mode === 'restore' && (
        <button type="button" className="primary setup-cta" onClick={restore} disabled={busy || !dir || !phrase.trim()}>
          {busy ? 'Restoring…' : 'Restore drive'}
        </button>
      )}
    </div>
  )
}
