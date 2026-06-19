import type { Config } from './config.ts'
import type { Database } from './db/client.ts'
import type { Logger } from './lib/logger.ts'
import type { AuthenticatedUser } from './types.ts'
import type { UserService } from './modules/users/users.service.ts'
import { createUserService } from './modules/users/users.service.ts'
import { createDrizzleUserRepository } from './modules/users/users.repository.drizzle.ts'

export type Deps = {
  config: Config
  userService: UserService
  // authService + rateStore are added in later phases.
}

export function createDeps(config: Config, db: Database): Deps {
  const userRepo = createDrizzleUserRepository(db)
  return {
    config,
    userService: createUserService({ repo: userRepo }),
  }
}

export type AppEnv = {
  Variables:
    & { requestId: string; logger: Logger }
    & Deps
    & { user: AuthenticatedUser }
}
