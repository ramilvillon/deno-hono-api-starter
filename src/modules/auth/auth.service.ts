import type { Config } from '../../config.ts'
import type { UserRepository } from '../users/users.repository.ts'
import type {
  NewRefreshToken,
  RefreshTokenRepository,
} from './token.repository.ts'
import type { SocialAccountRepository } from './social.repository.ts'
import { verifyPassword } from '../../lib/password.ts'
import { signAccessToken } from '../../lib/jwt.ts'
import { generateRefreshToken, hashToken } from '../../lib/tokens.ts'
import { AppError } from '../../lib/errors.ts'

export type TokenPair = {
  access_token: string
  refresh_token: string
  token_type: 'Bearer'
  expires_in: number
}

export type AuthService = ReturnType<typeof createAuthService>

export function createAuthService(deps: {
  userRepo: UserRepository
  tokenRepo: RefreshTokenRepository
  socialRepo: SocialAccountRepository
  config: Config
}) {
  const { userRepo, tokenRepo, config } = deps

  async function issueTokens(userId: string): Promise<TokenPair> {
    const access_token = await signAccessToken({
      sub: userId,
      secret: config.jwtSecret,
      ttlSeconds: config.accessTokenTtl,
    })
    const refresh = generateRefreshToken()
    const record: NewRefreshToken = {
      id: crypto.randomUUID(),
      userId,
      tokenHash: await hashToken(refresh),
      expiresAt: new Date(Date.now() + config.refreshTokenTtl * 1000),
    }
    await tokenRepo.create(record)
    return {
      access_token,
      refresh_token: refresh,
      token_type: 'Bearer',
      expires_in: config.accessTokenTtl,
    }
  }

  return {
    issueTokens,
    async passwordGrant(email: string, password: string): Promise<TokenPair> {
      const user = await userRepo.findByEmail(email)
      if (!user || !user.passwordHash) {
        throw AppError.unauthorized('invalid credentials')
      }
      if (!(await verifyPassword(password, user.passwordHash))) {
        throw AppError.unauthorized('invalid credentials')
      }
      return issueTokens(user.id)
    },
    async refreshGrant(refreshToken: string): Promise<TokenPair> {
      const hash = await hashToken(refreshToken)
      const existing = await tokenRepo.findValidByHash(hash)
      if (!existing) throw AppError.unauthorized('invalid refresh token')
      const refresh = generateRefreshToken()
      const next: NewRefreshToken = {
        id: crypto.randomUUID(),
        userId: existing.userId,
        tokenHash: await hashToken(refresh),
        expiresAt: new Date(Date.now() + config.refreshTokenTtl * 1000),
      }
      await tokenRepo.rotate(existing.id, next)
      const access_token = await signAccessToken({
        sub: existing.userId,
        secret: config.jwtSecret,
        ttlSeconds: config.accessTokenTtl,
      })
      return {
        access_token,
        refresh_token: refresh,
        token_type: 'Bearer',
        expires_in: config.accessTokenTtl,
      }
    },
    async revoke(refreshToken: string): Promise<void> {
      const existing = await tokenRepo.findValidByHash(
        await hashToken(refreshToken),
      )
      if (existing) await tokenRepo.revoke(existing.id)
    },
    async loginWithGoogle(
      profile: { providerAccountId: string; email: string },
    ): Promise<TokenPair> {
      const existing = await deps.socialRepo.findByProviderAccount(
        'google',
        profile.providerAccountId,
      )
      if (existing) return issueTokens(existing.userId)

      let user = await userRepo.findByEmail(profile.email)
      if (!user) {
        const now = new Date()
        user = await userRepo.create({
          id: crypto.randomUUID(),
          email: profile.email,
          passwordHash: null,
          createdAt: now,
          updatedAt: now,
        })
        await userRepo.assignRole(user.id, 'user')
      }
      await deps.socialRepo.link({
        id: crypto.randomUUID(),
        userId: user.id,
        provider: 'google',
        providerAccountId: profile.providerAccountId,
      })
      return issueTokens(user.id)
    },
    async resolveUser(userId: string) {
      const user = await userRepo.findWithAccessById(userId)
      if (!user) throw AppError.unauthorized('user not found')
      return {
        id: user.id,
        email: user.email,
        roles: user.roles,
        permissions: user.permissions,
      }
    },
  }
}
