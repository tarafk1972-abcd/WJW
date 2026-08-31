import { describe, expect, it } from 'vitest'
import { publishCommunityEvent, resetRealtimeListeners, subscribeCommunity } from './events.js'

describe('broker event tenant', () => {
  it('hanya mengirim invalidasi ke koneksi pada community yang sama', () => {
    resetRealtimeListeners()
    const first: string[] = []
    const second: string[] = []
    const stopFirst = subscribeCommunity('rw-a', (event) => first.push(event.communityId))
    subscribeCommunity('rw-b', (event) => second.push(event.communityId))

    publishCommunityEvent('rw-a', 'incident.updated', 'r_1')
    expect(first).toEqual(['rw-a'])
    expect(second).toEqual([])

    stopFirst()
    publishCommunityEvent('rw-a', 'incident.updated', 'r_2')
    expect(first).toEqual(['rw-a'])
  })
})
