import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { QrCode } from '../ui/QrCode'
import { inviteLink } from '../lib/db'

describe('QrCode', () => {
  it('renders a scannable data-url image for an invite link', async () => {
    render(<QrCode value={inviteLink('ABC234')} size={180} />)
    await waitFor(() => {
      const img = screen.getByAltText('QR') as HTMLImageElement
      expect(img.src.startsWith('data:image/png;base64,')).toBe(true)
      expect(img.width).toBe(180)
    })
  })
})
