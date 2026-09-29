// Pairing payload (QR / short code): v1 carries just the drive key as hex JSON.

export interface PairingPayload {
  v: 1
  kind: 'join'
  base: string // hex: autobase key of the shared filesystem
}

export function encodePairing (payload: PairingPayload): string {
  return JSON.stringify(payload)
}
