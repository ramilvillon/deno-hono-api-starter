import { assertEquals } from '@std/assert'
import { Hono } from 'hono'
import type { AppEnv } from '../src/deps.ts'
import { createMemoryRateLimitStore } from '../src/lib/rate-limit-store.ts'
import { makeRateLimiter } from '../src/middleware/rate-limit.ts'

Deno.test('limiter blocks after the configured number of hits', async () => {
  const app = new Hono<AppEnv>()
    .use(
      '*',
      makeRateLimiter(createMemoryRateLimitStore(), {
        windowMs: 60000,
        limit: 2,
      }),
    )
    .get('/', (c) => c.text('ok'))

  const hit = () =>
    app.request('/', { headers: { 'x-forwarded-for': '1.1.1.1' } })

  assertEquals((await hit()).status, 200)
  assertEquals((await hit()).status, 200)
  assertEquals((await hit()).status, 429)
})

Deno.test('limiter tracks clients independently by key', async () => {
  const app = new Hono<AppEnv>()
    .use(
      '*',
      makeRateLimiter(createMemoryRateLimitStore(), {
        windowMs: 60000,
        limit: 1,
      }),
    )
    .get('/', (c) => c.text('ok'))

  assertEquals(
    (await app.request('/', { headers: { 'x-forwarded-for': '1.1.1.1' } }))
      .status,
    200,
  )
  // different client key -> not throttled
  assertEquals(
    (await app.request('/', { headers: { 'x-forwarded-for': '2.2.2.2' } }))
      .status,
    200,
  )
  // first client again -> throttled
  assertEquals(
    (await app.request('/', { headers: { 'x-forwarded-for': '1.1.1.1' } }))
      .status,
    429,
  )
})
