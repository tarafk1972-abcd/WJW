import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let app: { fetch: (req: Request) => Response | Promise<Response> }
let dir: string

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'wjw-sse-'))
  process.env.WJW_DB = join(dir, 'test.sqlite')
  process.env.WJW_NO_LISTEN = '1'
  process.env.WJW_SUPERADMIN_PASSWORD = 'unused'
  app = (await import('./index.js')).app
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

async function json(path: string, body?: unknown, token?: string) {
  const response = await app.fetch(
    new Request(`http://test${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  )
  return { status: response.status, body: await response.json() }
}

describe('SSE /api/events', () => {
  it('mewajibkan token dan hanya mengalirkan sinyal invalidasi tenant sendiri', async () => {
    expect((await json('/api/events')).status).toBe(401)

    const registered = await json('/api/auth/register', {
      name: 'Admin SSE',
      phone: '08187770001',
      email: 'sse-admin@x.id',
      password: 'rahasia123',
      house: 'A-1',
      mode: 'create',
      communityName: 'RW SSE',
    })
    const registeredBody = registered.body as { token: string; member: { communityId: string } }
    const token = registeredBody.token
    const communityId = registeredBody.member.communityId
    const controller = new AbortController()
    const response = await app.fetch(
      new Request('http://test/api/events', {
        headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' },
        signal: controller.signal,
      }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/event-stream')

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    const ready = decoder.decode((await reader.read()).value)
    expect(ready).toContain('event: ready')

    const { publishCommunityEvent } = await import('./events.js')
    publishCommunityEvent(communityId, 'incident.updated', 'r_sse')
    let data = ''
    for (let attempt = 0; attempt < 3 && !data.includes('incident.updated'); attempt += 1) {
      data += decoder.decode((await reader.read()).value)
    }
    expect(data).toContain('event: state')
    expect(data).toContain('incident.updated')
    expect(data).toContain(communityId)

    controller.abort()
    await reader.cancel()
  })
})
