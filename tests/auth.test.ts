import { assert, assertEquals } from '@std/assert'
import { authHeader, makeTestApp } from './helpers.ts'

async function register(app: ReturnType<typeof makeTestApp>['app']) {
  await app.request('/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.com', password: 'pw123456' }),
  })
}

Deno.test('password grant then /users/me', async () => {
  const { app } = makeTestApp()
  await register(app)
  const { Authorization } = await authHeader(app, 'a@b.com', 'pw123456')
  const res = await app.request('/users/me', { headers: { Authorization } })
  assertEquals(res.status, 200)
  assertEquals((await res.json()).email, 'a@b.com')
})

Deno.test('refresh rotation + revoke', async () => {
  const { app } = makeTestApp()
  await register(app)
  const { refresh } = await authHeader(app, 'a@b.com', 'pw123456')

  const refreshed = await app.request('/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refresh,
    }),
  })
  assertEquals(refreshed.status, 200)
  const next = await refreshed.json()
  assert(next.refresh_token !== refresh)

  const revoke = await app.request('/oauth/revoke', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: next.refresh_token }),
  })
  assertEquals(revoke.status, 204)
})

Deno.test('/users/me without token -> 401', async () => {
  const { app } = makeTestApp()
  const res = await app.request('/users/me')
  assertEquals(res.status, 401)
})
