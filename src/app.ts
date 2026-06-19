import { Hono } from 'hono'
import { requestId } from 'hono/request-id'
import { secureHeaders } from 'hono/secure-headers'
import { cors } from 'hono/cors'

export function createApp() {
  const app = new Hono()
    .use('*', requestId())
    .use('*', secureHeaders())
    .use('*', cors())
    .get('/health', (c) => c.json({ status: 'ok' }))
  return app
}

export type AppType = ReturnType<typeof createApp>
