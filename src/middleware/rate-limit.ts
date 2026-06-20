import { rateLimiter, type Store } from 'hono-rate-limiter'
import type { AppEnv } from '../deps.ts'
import type { RateLimitStore } from '../lib/rate-limit-store.ts'

// `prefix` namespaces keys so multiple limiters can share one store without
// double-counting the same client (e.g. a global limiter and a stricter
// per-endpoint one). Keyed by user id when authenticated, else client IP.
export function makeRateLimiter(
  store: RateLimitStore,
  opts: { windowMs: number; limit: number; prefix?: string },
) {
  const prefix = opts.prefix ?? 'global'
  return rateLimiter<AppEnv>({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: 'draft-6',
    keyGenerator: (c) => {
      const id = c.var.user?.id ?? c.req.header('x-forwarded-for') ??
        'anonymous'
      return `${prefix}:${id}`
    },
    // The store only ever sees string keys, so it is independent of the Hono
    // Env; cast past the invariant Env generic here at the commitment point.
    store: store as Store<AppEnv>,
  })
}
