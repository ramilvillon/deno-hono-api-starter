import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { describeRoute } from 'hono-openapi'
import type { AppEnv } from '../../deps.ts'
import { registerSchema, updateUserSchema } from './users.schema.ts'
import { requireAuth } from '../../middleware/auth.ts'
import {
  requirePermission,
  requireSelfOrPermission,
} from '../../middleware/authorize.ts'

const users = new Hono<AppEnv>()
  .post(
    '/',
    describeRoute({
      description: 'Register a new user',
      responses: {
        201: { description: 'Created' },
        400: { description: 'Invalid input' },
        409: { description: 'Email already registered' },
      },
    }),
    zValidator('json', registerSchema),
    async (c) => {
      const user = await c.var.userService.register(c.req.valid('json'))
      return c.json(user, 201)
    },
  )
  .get('/me', requireAuth, (c) => c.json(c.var.user, 200))
  .get('/', requireAuth, requirePermission('users:list'), async (c) => {
    return c.json(await c.var.userService.list(), 200)
  })
  .get(
    '/:id',
    requireAuth,
    requireSelfOrPermission('id', 'users:read:any'),
    async (c) => {
      return c.json(await c.var.userService.getById(c.req.param('id')), 200)
    },
  )
  .patch(
    '/:id',
    requireAuth,
    requireSelfOrPermission('id', 'users:update:any'),
    zValidator('json', updateUserSchema),
    async (c) => {
      return c.json(
        await c.var.userService.update(c.req.param('id'), c.req.valid('json')),
        200,
      )
    },
  )
  .delete(
    '/:id',
    requireAuth,
    requireSelfOrPermission('id', 'users:delete:any'),
    async (c) => {
      await c.var.userService.remove(c.req.param('id'))
      return c.body(null, 204)
    },
  )

export default users
