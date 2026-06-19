import type { Deps } from '../src/deps.ts'
import { createApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { createInMemoryUserRepository } from '../src/modules/users/users.repository.ts'
import { createUserService } from '../src/modules/users/users.service.ts'
import { ROLE_GRANTS } from '../src/db/rbac-constants.ts'

const testEnv = {
  DATABASE_URL: 'mysql://app:app@localhost:3306/app',
  JWT_SECRET: 'test-secret',
  LOG_LEVEL: 'silent',
}

export function makeTestDeps(overrides: Partial<Deps> = {}): Deps {
  const config = loadConfig(testEnv)
  const userRepo = createInMemoryUserRepository(ROLE_GRANTS)
  return {
    config,
    userService: createUserService({ repo: userRepo }),
    ...overrides,
  }
}

export function makeTestApp(overrides: Partial<Deps> = {}) {
  return createApp(makeTestDeps(overrides))
}
