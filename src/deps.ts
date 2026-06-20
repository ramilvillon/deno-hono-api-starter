import type { Config } from './config.ts'
import type { Database } from './db/client.ts'
import type { Logger } from './lib/logger.ts'
import type { AuthenticatedUser } from './types.ts'
import type { UserService } from './modules/users/users.service.ts'
import type { AuthService } from './modules/auth/auth.service.ts'
import { createUserService } from './modules/users/users.service.ts'
import { createAuthService } from './modules/auth/auth.service.ts'
import { createDrizzleUserRepository } from './modules/users/users.repository.drizzle.ts'
import { createDrizzleRefreshTokenRepository } from './modules/auth/token.repository.drizzle.ts'
import { createDrizzleSocialAccountRepository } from './modules/auth/social.repository.drizzle.ts'

export type Deps = {
  config: Config
  userService: UserService
  authService: AuthService
  // rateStore is added in the rate-limiting phase.
}

export function createDeps(config: Config, db: Database): Deps {
  const userRepo = createDrizzleUserRepository(db)
  const tokenRepo = createDrizzleRefreshTokenRepository(db)
  const socialRepo = createDrizzleSocialAccountRepository(db)
  return {
    config,
    userService: createUserService({ repo: userRepo }),
    authService: createAuthService({ userRepo, tokenRepo, socialRepo, config }),
  }
}

export type AppEnv = {
  Variables:
    & { requestId: string; logger: Logger }
    & Deps
    & { user: AuthenticatedUser }
}
