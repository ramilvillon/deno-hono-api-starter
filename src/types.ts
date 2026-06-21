import type { Logger } from './lib/logger.ts'
import type { Config } from './config.ts'

export type AuthenticatedUser = {
  id: string
  email: string
  roles: string[]
  permissions: string[]
}

export type AppVariables = {
  requestId: string
  logger: Logger
  config: Config
  user: AuthenticatedUser
}
