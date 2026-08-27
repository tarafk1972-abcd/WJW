import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { translate, type Key } from '../lib/i18n'
import type { Community, Member, Report } from '../lib/types'

const mocks = vi.hoisted(() => ({
  raise: vi.fn(),
  syncState: vi.fn(),
  getFix: vi.fn(),
  watchLocation: vi.fn(() => () => {}),
  toast: vi.fn(),
  app: null as unknown,
}))

vi.mock('../lib/api', () => ({
  ApiError: class ApiError extends Error {
    status: number

    constructor(code: string, status: number) {
      super(code)
      this.status = status
    }
  },
  alertApi: {
    raise: mocks.raise,
    location: vi.fn(),
    attach: vi.fn(),
    close: vi.fn(),
    respond: vi.fn(),
  },
}))
vi.mock('../lib/capture', () => ({
  getFix: mocks.getFix,
  watchLocation: mocks.watchLocation,
}))
vi.mock('../lib/sync', () => ({
  apiMode: () => true,
  syncState: mocks.syncState,
  mutate: async (operation: () => Promise<unknown>) => {
    try {
      await operation()
      return true
    } catch {
      return false
    }
  },
}))
vi.mock('../lib/store', () => ({ useApp: () => mocks.app }))
vi.mock('../ui/Toast', () => ({ useToast: () => mocks.toast }))
vi.mock('../ui/PanicGrid', () => ({
  PanicGrid: ({ onTrigger }: { onTrigger: (type: 'medical') => void }) => (
    <button onClick={() => onTrigger('medical')}>Mulai SOS uji</button>
  ),
}))
vi.mock('../ui/Countdown', () => ({
  Countdown: ({ onDone }: { onDone: () => void }) => (
    <button onClick={onDone}>Konfirmasi kirim SOS</button>
  ),
}))

import Panic from '../pages/Panic'
import { ApiError } from '../lib/api'

const me: Member = {
  id: 'm-pelapor',
  communityId: 'c-uji',
  name: 'Pelapor Uji',
  phone: '08170000001',
  email: 'pelapor@uji.id',
  password: '',
  house: 'A-01',
  role: 'warga',
  status: 'active',
  language: 'id',
  deviceId: null,
  createdAt: 1,
  decidedAt: 1,
  decidedBy: null,
  joinNote: '',
}

const community: Community = {
  id: 'c-uji',
  name: 'RW Uji',
  address: '',
  city: 'Bandung',
  createdAt: 1,
  createdBy: me.id,
  area: [],
  areaUpdatedAt: null,
  areaUpdatedBy: null,
  center: { lat: -6.9, lng: 107.6 },
  language: 'id',
  plan: 'trial',
  planName: 'trial',
  trialEndsAt: 9_999_999_999,
  paidUntil: null,
}

const confirmedReport: Report = {
  id: 'r-terkonfirmasi',
  communityId: community.id,
  authorId: me.id,
  kind: 'sos',
  category: 'medical',
  note: '',
  at: null,
  address: me.house,
  status: 'open',
  incidentStatus: 'NEW',
  createdAt: 1,
  handledBy: null,
  handledAt: null,
  insideArea: null,
  attachments: [],
  messages: [],
  responders: [],
  track: [],
  live: true,
  liveEndedAt: null,
  audio: null,
  audioSeconds: 0,
  snapshot: {
    name: me.name,
    phone: me.phone,
    house: me.house,
    bloodType: '',
    allergies: '',
    conditions: '',
    contactName: '',
    contactPhone: '',
    notes: '',
  },
  recipients: [],
  cancelledAt: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getFix.mockResolvedValue(null)
  mocks.app = {
    db: { reports: [], contacts: [], members: [] },
    me,
    community,
    lang: 'id',
    t: (key: Key, vars?: Record<string, string | number>) => translate('id', key, vars),
  }
})

describe('Panic — keandalan konfirmasi SOS', () => {
  it('mengulang request yang ambigu dengan idempotency key asli dan tetap menampilkan konfirmasi saat refresh snapshot gagal', async () => {
    const user = userEvent.setup()
    mocks.raise
      .mockRejectedValueOnce(new Error('request timeout setelah terkirim'))
      .mockResolvedValueOnce({ report: confirmedReport })
    // Ini mensimulasikan PUT/POST sukses, lalu GET /api/state yang putus.
    // Tampilan tidak boleh menghapus SOS yang sudah dikonfirmasi server.
    mocks.syncState.mockRejectedValueOnce(new Error('state refresh unavailable'))

    render(
      <MemoryRouter>
        <Panic />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: 'Mulai SOS uji' }))
    await user.click(screen.getByRole('button', { name: 'Konfirmasi kirim SOS' }))
    const retry = await screen.findByRole('button', { name: /Kirim ulang SOS/i })
    const firstKey = mocks.raise.mock.calls[0]?.[3]
    expect(firstKey).toEqual(expect.any(String))

    await user.click(retry)
    await waitFor(() => expect(screen.getByText('PERINGATAN AKTIF')).toBeTruthy())

    expect(mocks.raise).toHaveBeenCalledTimes(2)
    expect(mocks.raise.mock.calls[1]?.[3]).toBe(firstKey)
    expect(mocks.syncState).toHaveBeenCalledTimes(1)
    // Tidak ada retry baru/claim "belum terkonfirmasi" setelah POST kedua
    // memang membalas sukses; respons POST menjadi tampilan sementara.
    expect(screen.queryByRole('button', { name: /Kirim ulang SOS/i })).toBeNull()
    expect(mocks.toast).toHaveBeenLastCalledWith('SOS dicatat server untuk 0 penerima', 'ok')
  })

  it('tidak menyebut delivery ambigu atau menawarkan retry setelah server menolak request secara eksplisit', async () => {
    const user = userEvent.setup()
    mocks.raise.mockRejectedValueOnce(new ApiError('errRequired', 422))

    render(
      <MemoryRouter>
        <Panic />
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: 'Mulai SOS uji' }))
    await user.click(screen.getByRole('button', { name: 'Konfirmasi kirim SOS' }))

    await waitFor(() => expect(mocks.toast).toHaveBeenLastCalledWith('Terjadi kesalahan. Coba lagi.', 'err'))
    expect(screen.queryByRole('button', { name: /Kirim ulang SOS/i })).toBeNull()
    expect(mocks.syncState).not.toHaveBeenCalled()
  })
})
