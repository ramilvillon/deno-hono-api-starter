import { assertEquals } from '@std/assert'
import { loadConfig } from '../src/config.ts'
import { createDb } from '../src/db/client.ts'
import { createDrizzleUserRepository } from '../src/modules/users/users.repository.drizzle.ts'

const url = Deno.env.get('DATABASE_URL')

Deno.test({
  name: 'drizzle user repo create/find (needs MySQL + seed)',
  ignore: !url,
  fn: async () => {
    const { db, pool } = createDb(loadConfig(Deno.env.toObject()))
    const repo = createDrizzleUserRepository(db)
    const id = crypto.randomUUID()
    const now = new Date()
    await repo.create({
      id,
      email: `${id}@b.com`,
      passwordHash: 'h',
      createdAt: now,
      updatedAt: now,
    })
    await repo.assignRole(id, 'user')
    const access = await repo.findWithAccessById(id)
    assertEquals(access?.roles, ['user'])
    await repo.delete(id)
    await pool.end()
  },
})
