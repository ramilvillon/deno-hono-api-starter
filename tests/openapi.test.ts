import { assert, assertEquals } from '@std/assert'
import { makeTestApp } from './helpers.ts'

Deno.test('serves an OpenAPI document', async () => {
  const { app } = makeTestApp()
  const res = await app.request('/openapi')
  assertEquals(res.status, 200)
  const doc = await res.json()
  assert(doc.openapi.startsWith('3'))
  assert(doc.paths['/users'])
})

Deno.test('serves Scalar docs page', async () => {
  const { app } = makeTestApp()
  const res = await app.request('/docs')
  assertEquals(res.status, 200)
  assert((res.headers.get('content-type') ?? '').includes('text/html'))
})
