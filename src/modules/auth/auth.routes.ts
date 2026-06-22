import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { googleAuth } from '@hono/oauth-providers/google'
import { describeRoute } from 'hono-openapi'
import type { OpenAPIV3 } from 'openapi-types'
import type { AppEnv } from '../../deps.ts'
import { revokeSchema, tokenRequestSchema } from './auth.schema.ts'

// OpenAPI schema fragments, kept in sync with the zod schemas in auth.schema.ts.
const tokenRequestBody: OpenAPIV3.SchemaObject = {
  oneOf: [
    {
      type: 'object',
      title: 'Password grant',
      properties: {
        grant_type: { type: 'string', enum: ['password'] },
        username: { type: 'string', format: 'email' },
        password: { type: 'string', minLength: 1 },
      },
      required: ['grant_type', 'username', 'password'],
    },
    {
      type: 'object',
      title: 'Refresh token grant',
      properties: {
        grant_type: { type: 'string', enum: ['refresh_token'] },
        refresh_token: { type: 'string', minLength: 1 },
      },
      required: ['grant_type', 'refresh_token'],
    },
  ],
}

const tokenPairResponse: OpenAPIV3.SchemaObject = {
  type: 'object',
  properties: {
    access_token: { type: 'string' },
    refresh_token: { type: 'string' },
    token_type: { type: 'string', enum: ['Bearer'] },
    expires_in: { type: 'integer', description: 'Access token TTL in seconds' },
  },
  required: ['access_token', 'refresh_token', 'token_type', 'expires_in'],
}

const revokeBody: OpenAPIV3.SchemaObject = {
  type: 'object',
  properties: { refresh_token: { type: 'string', minLength: 1 } },
  required: ['refresh_token'],
}

const json = (schema: OpenAPIV3.SchemaObject) => ({
  'application/json': { schema },
})

const auth = new Hono<AppEnv>()
  .post(
    '/token',
    describeRoute({
      tags: ['Auth'],
      summary: 'Issue tokens (password or refresh_token grant)',
      requestBody: { content: json(tokenRequestBody) },
      responses: {
        200: {
          description: 'A new access/refresh token pair',
          content: json(tokenPairResponse),
        },
        400: { description: 'Invalid request body' },
        401: { description: 'Invalid credentials or refresh token' },
      },
    }),
    zValidator('json', tokenRequestSchema),
    async (c) => {
      const body = c.req.valid('json')
      const svc = c.var.authService
      const pair = body.grant_type === 'password'
        ? await svc.passwordGrant(body.username, body.password)
        : await svc.refreshGrant(body.refresh_token)
      return c.json(pair, 200)
    },
  )
  .post(
    '/revoke',
    describeRoute({
      tags: ['Auth'],
      summary: 'Revoke a refresh token',
      requestBody: { content: json(revokeBody) },
      responses: {
        204: { description: 'Revoked (idempotent)' },
        400: { description: 'Invalid request body' },
      },
    }),
    zValidator('json', revokeSchema),
    async (c) => {
      await c.var.authService.revoke(c.req.valid('json').refresh_token)
      return c.body(null, 204)
    },
  )
  // `googleAuth` handles both initiating the redirect to Google and processing
  // the callback on the same route (the route must equal GOOGLE_REDIRECT_URI).
  .use('/google', (c, next) =>
    googleAuth({
      client_id: c.var.config.google.clientId,
      client_secret: c.var.config.google.clientSecret,
      redirect_uri: c.var.config.google.redirectUri,
      scope: ['openid', 'email', 'profile'],
    })(c, next))
  .get(
    '/google',
    describeRoute({
      tags: ['Auth'],
      summary: 'Google social login (redirect + callback)',
      description:
        'Without an OAuth code, redirects to the Google consent screen. ' +
        'Google redirects back to this same route with a code, which is ' +
        'exchanged for a token pair.',
      responses: {
        200: {
          description: 'Token pair for the Google-authenticated user',
          content: json(tokenPairResponse),
        },
        302: { description: 'Redirect to the Google consent screen' },
        401: { description: 'Google profile missing or unverified' },
      },
    }),
    async (c) => {
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
    },
  )

export default auth
