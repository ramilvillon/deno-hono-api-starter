import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { describeRoute } from 'hono-openapi'
import type { OpenAPIV3 } from 'openapi-types'
import type { AppEnv } from '../../deps.ts'
import { registerSchema, updateUserSchema } from './users.schema.ts'
import { requireAuth } from '../../middleware/auth.ts'
import {
  requirePermission,
  requireSelfOrPermission,
} from '../../middleware/authorize.ts'

// OpenAPI schema fragments, kept in sync with the zod schemas in users.schema.ts.
const userResponse: OpenAPIV3.SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid' },
    email: { type: 'string', format: 'email' },
    createdAt: { type: 'string', format: 'date-time' },
  },
  required: ['id', 'email', 'createdAt'],
}

const registerBody: OpenAPIV3.SchemaObject = {
  type: 'object',
  properties: {
    email: { type: 'string', format: 'email' },
    password: { type: 'string', minLength: 8 },
  },
  required: ['email', 'password'],
}

const updateBody: OpenAPIV3.SchemaObject = {
  type: 'object',
  description: 'At least one field must be provided.',
  properties: {
    email: { type: 'string', format: 'email' },
    password: { type: 'string', minLength: 8 },
  },
  minProperties: 1,
}

const idParam: OpenAPIV3.ParameterObject = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'User id',
  schema: { type: 'string', format: 'uuid' },
}

const json = (schema: OpenAPIV3.SchemaObject) => ({
  'application/json': { schema },
})

const users = new Hono<AppEnv>()
  .post(
    '/',
    describeRoute({
      tags: ['Users'],
      summary: 'Register a new user',
      requestBody: { content: json(registerBody) },
      responses: {
        201: { description: 'Created', content: json(userResponse) },
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
  .get(
    '/me',
    describeRoute({
      tags: ['Users'],
      summary: 'Get the authenticated user',
      security: [{ bearerAuth: [] }],
      responses: {
        200: { description: 'The current user', content: json(userResponse) },
        401: { description: 'Missing or invalid access token' },
      },
    }),
    requireAuth,
    (c) => c.json(c.var.user, 200),
  )
  .get(
    '/',
    describeRoute({
      tags: ['Users'],
      summary: 'List all users',
      security: [{ bearerAuth: [] }],
      responses: {
        200: {
          description: 'All users',
          content: json({ type: 'array', items: userResponse }),
        },
        401: { description: 'Missing or invalid access token' },
        403: { description: 'Missing the users:list permission' },
      },
    }),
    requireAuth,
    requirePermission('users:list'),
    async (c) => {
      return c.json(await c.var.userService.list(), 200)
    },
  )
  .get(
    '/:id',
    describeRoute({
      tags: ['Users'],
      summary: 'Get a user by id',
      security: [{ bearerAuth: [] }],
      parameters: [idParam],
      responses: {
        200: { description: 'The user', content: json(userResponse) },
        401: { description: 'Missing or invalid access token' },
        403: { description: 'Not the owner and missing users:read:any' },
        404: { description: 'User not found' },
      },
    }),
    requireAuth,
    requireSelfOrPermission('id', 'users:read:any'),
    async (c) => {
      return c.json(await c.var.userService.getById(c.req.param('id')), 200)
    },
  )
  .patch(
    '/:id',
    describeRoute({
      tags: ['Users'],
      summary: 'Update a user',
      security: [{ bearerAuth: [] }],
      parameters: [idParam],
      requestBody: { content: json(updateBody) },
      responses: {
        200: { description: 'The updated user', content: json(userResponse) },
        400: { description: 'Invalid input' },
        401: { description: 'Missing or invalid access token' },
        403: { description: 'Not the owner and missing users:update:any' },
        404: { description: 'User not found' },
      },
    }),
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
    describeRoute({
      tags: ['Users'],
      summary: 'Delete a user',
      security: [{ bearerAuth: [] }],
      parameters: [idParam],
      responses: {
        204: { description: 'Deleted' },
        401: { description: 'Missing or invalid access token' },
        403: { description: 'Not the owner and missing users:delete:any' },
        404: { description: 'User not found' },
      },
    }),
    requireAuth,
    requireSelfOrPermission('id', 'users:delete:any'),
    async (c) => {
      await c.var.userService.remove(c.req.param('id'))
      return c.body(null, 204)
    },
  )

export default users
