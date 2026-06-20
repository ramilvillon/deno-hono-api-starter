import { and, eq, gt, isNull } from 'drizzle-orm'
import type { Database } from '../../db/client.ts'
import { refreshTokens } from '../../db/schema.ts'
import type { RefreshTokenRepository } from './token.repository.ts'

export function createDrizzleRefreshTokenRepository(
  db: Database,
): RefreshTokenRepository {
  return {
    async create(token) {
      await db.insert(refreshTokens).values({ ...token, createdAt: new Date() })
    },
    async findValidByHash(tokenHash) {
      const row = await db.query.refreshTokens.findFirst({
        where: and(
          eq(refreshTokens.tokenHash, tokenHash),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, new Date()),
        ),
      })
      return row ?? null
    },
    async rotate(oldId, next) {
      await db.update(refreshTokens)
        .set({ revokedAt: new Date(), replacedBy: next.id })
        .where(eq(refreshTokens.id, oldId))
      await db.insert(refreshTokens).values({ ...next, createdAt: new Date() })
    },
    async revoke(id) {
      await db.update(refreshTokens).set({ revokedAt: new Date() }).where(
        eq(refreshTokens.id, id),
      )
    },
    async revokeAllForUser(userId) {
      await db.update(refreshTokens).set({ revokedAt: new Date() }).where(
        eq(refreshTokens.userId, userId),
      )
    },
  }
}
