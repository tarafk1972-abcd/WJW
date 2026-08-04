import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../App'
import { createInvite, invalidateCache, register } from '../lib/db'

vi.mock('../ui/MapView', () => ({ MapView: () => <div />, pinIcon: () => null }))

describe('routing after react-router v8 migration', () => {
  beforeEach(() => {
    localStorage.clear()
    invalidateCache()
    window.location.hash = '#/'
  })

  it('renders the landing route', () => {
    render(<App />)
    expect(screen.getByRole('button', { name: /Daftar Sekarang/i })).toBeTruthy()
  })

  it('navigates between routes with useNavigate', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /Masuk/i }))
    await waitFor(() => expect(window.location.hash).toBe('#/login'))
  })

  it('reads :code from a QR deep link via useParams', async () => {
    const f = register({
      name: 'Budi', phone: '0811000001', email: 'b@x.id', password: 'secret1',
      house: 'C12', language: 'id', mode: 'create', communityName: 'RW 05 Test',
    })
    if (!f.ok) throw new Error('setup')
    const inv = createInvite(f.member.id, f.community.id, 'warga')
    localStorage.removeItem('wjw.session.v1')

    window.location.hash = `#/join/${inv.code}`
    render(<App />)
    // the invite code from the URL must be applied to the form
    expect(await screen.findByDisplayValue(inv.code)).toBeTruthy()
    expect(screen.getByText('RW 05 Test')).toBeTruthy()
  })
})
