import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import type { AppEnv } from '../../deps.ts'
import { revokeSchema, tokenRequestSchema } from './auth.schema.ts'

const auth = new Hono<AppEnv>()
  .post('/token', zValidator('json', tokenRequestSchema), async (c) => {
    const body = c.req.valid('json')
    const svc = c.var.authService
    const pair = body.grant_type === 'password'
      ? await svc.passwordGrant(body.username, body.password)
      : await svc.refreshGrant(body.refresh_token)
    return c.json(pair, 200)
  })
  .post('/revoke', zValidator('json', revokeSchema), async (c) => {
    await c.var.authService.revoke(c.req.valid('json').refresh_token)
    return c.body(null, 204)
  })

export default auth
