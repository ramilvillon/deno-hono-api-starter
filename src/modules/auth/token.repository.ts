export type RefreshTokenRecord = {
  id: string
  userId: string
  tokenHash: string
  expiresAt: Date
  revokedAt?: Date | null
  replacedBy?: string | null
}

export type NewRefreshToken = Pick<
  RefreshTokenRecord,
  'id' | 'userId' | 'tokenHash' | 'expiresAt'
>

export type RefreshTokenRepository = {
  create(token: NewRefreshToken): Promise<void>
  findValidByHash(tokenHash: string): Promise<RefreshTokenRecord | null>
  rotate(oldId: string, next: NewRefreshToken): Promise<void>
  revoke(id: string): Promise<void>
  revokeAllForUser(userId: string): Promise<void>
}

export function createInMemoryRefreshTokenRepository(): RefreshTokenRepository {
  const byId = new Map<string, RefreshTokenRecord>()
  const isValid = (t: RefreshTokenRecord) =>
    !t.revokedAt && t.expiresAt.getTime() > Date.now()

  return {
    create(token) {
      byId.set(token.id, { ...token, revokedAt: null, replacedBy: null })
      return Promise.resolve()
    },
    findValidByHash(tokenHash) {
      for (const t of byId.values()) {
        if (t.tokenHash === tokenHash && isValid(t)) {
          return Promise.resolve({ ...t })
        }
      }
      return Promise.resolve(null)
    },
    rotate(oldId, next) {
      const old = byId.get(oldId)
      if (old) {
        byId.set(oldId, { ...old, revokedAt: new Date(), replacedBy: next.id })
      }
      byId.set(next.id, { ...next, revokedAt: null, replacedBy: null })
      return Promise.resolve()
    },
    revoke(id) {
      const t = byId.get(id)
      if (t) byId.set(id, { ...t, revokedAt: new Date() })
      return Promise.resolve()
    },
    revokeAllForUser(userId) {
      for (const [id, t] of byId) {
        if (t.userId === userId) byId.set(id, { ...t, revokedAt: new Date() })
      }
      return Promise.resolve()
    },
  }
}
