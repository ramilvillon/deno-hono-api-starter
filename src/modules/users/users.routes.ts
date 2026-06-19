import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import type { AppEnv } from '../../deps.ts'
import { registerSchema } from './users.schema.ts'

const users = new Hono<AppEnv>()
  .post('/', zValidator('json', registerSchema), async (c) => {
    const input = c.req.valid('json')
    const user = await c.var.userService.register(input)
    return c.json(user, 201)
  })

export default users
