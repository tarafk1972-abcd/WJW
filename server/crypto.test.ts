import { randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { decryptSensitiveJson, encryptSensitiveJson } from './crypto.js'

const original = process.env.WJW_DATA_ENCRYPTION_KEY

afterEach(() => {
  if (original === undefined) delete process.env.WJW_DATA_ENCRYPTION_KEY
  else process.env.WJW_DATA_ENCRYPTION_KEY = original
})

describe('enkripsi data sensitif', () => {
  it('mengenkripsi AES-GCM dan dapat mendekripsi kembali snapshot', () => {
    process.env.WJW_DATA_ENCRYPTION_KEY = randomBytes(32).toString('base64url')
    const source = { allergies: 'penisilin', contactPhone: '08123456789' }
    const encrypted = encryptSensitiveJson(source)

    expect(encrypted).toMatch(/^enc:v1:/)
    expect(encrypted).not.toContain('penisilin')
    expect(decryptSensitiveJson<typeof source>(encrypted)).toEqual(source)
  })

  it('tetap membaca data plaintext lama untuk migrasi sekali jalan', () => {
    delete process.env.WJW_DATA_ENCRYPTION_KEY
    expect(decryptSensitiveJson<{ bloodType: string }>(JSON.stringify({ bloodType: 'O+' }))).toEqual({
      bloodType: 'O+',
    })
  })
})
