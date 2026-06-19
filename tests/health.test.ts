import { assertEquals } from '@std/assert'
import { createApp } from '../src/app.ts'

Deno.test('GET /health returns ok', async () => {
  const app = createApp()
  const res = await app.request('/health')
  assertEquals(res.status, 200)
  assertEquals(await res.json(), { status: 'ok' })
})
