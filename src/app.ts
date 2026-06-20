import { Hono } from 'hono'
import { requestId } from 'hono/request-id'
import { secureHeaders } from 'hono/secure-headers'
import { cors } from 'hono/cors'
import { timeout } from 'hono/timeout'
import { HTTPException } from 'hono/http-exception'
import { pinoLogger } from 'hono-pino'
import { openAPISpecs } from 'hono-openapi'
import { apiReference } from '@scalar/hono-api-reference'
import type { AppEnv, Deps } from './deps.ts'
import { injectDeps } from './middleware/deps.ts'
import { createLogger } from './lib/logger.ts'
import { AppError } from './lib/errors.ts'
import { makeRateLimiter } from './middleware/rate-limit.ts'
import users from './modules/users/users.routes.ts'
import auth from './modules/auth/auth.routes.ts'

export function createApp(deps: Deps) {
  const logger = createLogger(deps.config)
  const { windowMs, max } = deps.config.rateLimit
  const app = new Hono<AppEnv>()
    .use('*', requestId())
    .use('*', pinoLogger({ pino: logger }))
    .use('*', secureHeaders())
    .use('*', cors())
    .use('*', timeout(15000))
    .use('*', injectDeps(deps))
    // Lenient global limiter, then a stricter limiter throttling credential
    // and social-login attempts.
    .use(
      '*',
      makeRateLimiter(deps.rateStore, {
        windowMs,
        limit: max,
        prefix: 'global',
      }),
    )
    .use(
      '/oauth/token',
      makeRateLimiter(deps.rateStore, { windowMs, limit: 10, prefix: 'login' }),
    )
    .use(
      '/oauth/google',
      makeRateLimiter(deps.rateStore, { windowMs, limit: 10, prefix: 'login' }),
    )
    .get('/health', (c) => c.json({ status: 'ok' }))
    .route('/users', users)
    .route('/oauth', auth)

  // Registered after the routes so the spec can introspect every mounted path.
  app.get(
    '/openapi',
    openAPISpecs(app, {
      documentation: {
        info: {
          title: 'API Boilerplate',
          version: '1.0.0',
          description: 'Hono + Deno REST API boilerplate',
        },
      },
    }),
  )
  // `url` is the documented runtime config, but @scalar/types@0.0.40 types the
  // option as an over-narrow union that omits it at the top level; cast past it.
  app.get(
    '/docs',
    apiReference({ url: '/openapi' } as Parameters<typeof apiReference>[0]),
  )

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json(
        { error: { code: err.code, message: err.message } },
        err.status,
      )
    }
    if (err instanceof HTTPException) {
      return c.json(
        { error: { code: 'http_error', message: err.message } },
        err.status,
      )
    }
    return c.json(
      { error: { code: 'internal', message: 'Internal Server Error' } },
      500,
    )
  })

  return app
}

export type AppType = ReturnType<typeof createApp>
