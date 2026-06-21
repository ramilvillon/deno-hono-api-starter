import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { googleAuth } from '@hono/oauth-providers/google'
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
  // `googleAuth` handles both initiating the redirect to Google and processing
  // the callback on the same route (the route must equal GOOGLE_REDIRECT_URI).
  .use('/google', (c, next) =>
    googleAuth({
      client_id: c.var.config.google.clientId,
      client_secret: c.var.config.google.clientSecret,
      redirect_uri: c.var.config.google.redirectUri,
      scope: ['openid', 'email', 'profile'],
    })(c, next))
  .get('/google', async (c) => {
    const profile = c.get('user-google')
    if (!profile?.id || !profile.email) {
      return c.json(
        { error: { code: 'oauth_failed', message: 'no google profile' } },
        401,
      )
    }
    const pair = await c.var.authService.loginWithGoogle({
      providerAccountId: profile.id,
      email: profile.email,
      emailVerified: profile.verified_email ?? false,
    })
    return c.json(pair, 200)
  })

export default auth
