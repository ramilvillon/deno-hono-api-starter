import { assert, assertEquals } from '@std/assert'
import { createInMemoryRefreshTokenRepository } from '../src/modules/auth/token.repository.ts'

Deno.test('store, find valid, rotate', async () => {
  const repo = createInMemoryRefreshTokenRepository()
  const future = new Date(Date.now() + 10000)
  await repo.create({
    id: 't1',
    userId: 'u1',
    tokenHash: 'h1',
    expiresAt: future,
  })
  assertEquals((await repo.findValidByHash('h1'))?.id, 't1')

  await repo.rotate('t1', {
    id: 't2',
    userId: 'u1',
    tokenHash: 'h2',
    expiresAt: future,
  })
  assertEquals(await repo.findValidByHash('h1'), null) // revoked
  assert((await repo.findValidByHash('h2')) !== null)
})
