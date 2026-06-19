# Hono + Deno API Boilerplate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a production-shaped Deno + Hono + TypeScript REST API boilerplate with OAuth2 auth (access + refresh), Google social login, RBAC with ownership, pluggable rate limiting, Drizzle/MySQL persistence, OpenAPI/Scalar docs, an `hc` RPC client, and husky+gitleaks pre-commit checks — built entirely with factory-function composition (no inheritance).

**Architecture:** Dependencies flow inward (`config → db → repositories → services → deps`). Route modules follow Hono's "Building a larger application" idiom: module-level, method-chained `new Hono()` sub-apps mounted with `app.route()`. Services/repos are supplied to handlers through an `injectDeps` middleware (read via `c.var`), so route files stay dependency-free, RPC type inference is preserved, and the same modules run against in-memory fakes in tests.

**Tech Stack:** Deno 2.7.13 (asdf), Hono, Zod, `@hono/zod-validator`, Drizzle ORM + MySQL (`mysql2`), `hono/jwt`, `bcryptjs`, `@hono/oauth-providers` (Google), `hono-rate-limiter`, `hono-pino`/pino, `hono-openapi` + Scalar, husky + gitleaks.

**Spec:** `docs/superpowers/specs/2026-06-19-hono-deno-api-boilerplate-design.md`

---

## Conventions used by every task

- **TDD:** write the test, watch it fail, implement minimally, watch it pass, commit.
- **Run tests:** `deno test -A` (the suite needs env/file/net for the in-process app). Single file: `deno test -A tests/<file>.test.ts`.
- **Type/lint gate before each commit:** `deno check src/ tests/ && deno lint && deno fmt`.
- **Domain types (locked — use these exact names across all tasks):**
  - `UserRecord = { id: string; email: string; passwordHash: string | null; createdAt: Date; updatedAt: Date }`
  - `AuthenticatedUser = { id: string; email: string; roles: string[]; permissions: string[] }`
  - `PublicUser = { id: string; email: string; createdAt: Date }`
  - `TokenPair = { access_token: string; refresh_token: string; token_type: "Bearer"; expires_in: number }`
  - `Deps = { config: Config; rateStore: RateLimitStore; userService: UserService; authService: AuthService }`
  - Hono env: `type AppEnv = { Variables: { requestId: string; logger: Logger; user: AuthenticatedUser } & Deps }`

---

## Phase 0 — Project scaffold & running server

### Task 0.1: Tooling files (asdf, deno.json, gitignore)

**Files:**
- Create: `.tool-versions`, `deno.json`, `.gitignore`, `.env.example`

- [ ] **Step 1: Write `.tool-versions`**

```
deno 2.7.13
nodejs 24.14.1
gitleaks 8.30.1
```

- [ ] **Step 2: Write `deno.json`** (import map + tasks). Use `deno add` afterward to resolve exact versions; these ranges are the starting point.

```jsonc
{
  "tasks": {
    "dev": "deno run -A --watch --env-file=.env src/main.ts",
    "start": "deno run -A --env-file=.env src/main.ts",
    "test": "deno test -A",
    "check": "deno check src/ tests/",
    "lint": "deno lint",
    "fmt": "deno fmt",
    "check:all": "deno fmt --check && deno lint && deno check src/ tests/",
    "db:generate": "deno run -A --env-file=.env npm:drizzle-kit generate",
    "db:migrate": "deno run -A --env-file=.env npm:drizzle-kit migrate",
    "db:seed": "deno run -A --env-file=.env src/db/seed.ts"
  },
  "imports": {
    "hono": "npm:hono@^4.6.14",
    "hono/": "npm:/hono@^4.6.14/",
    "@hono/zod-validator": "npm:@hono/zod-validator@^0.4.1",
    "@hono/oauth-providers": "npm:@hono/oauth-providers@^0.6.2",
    "hono-openapi": "npm:hono-openapi@^0.4.2",
    "hono-pino": "npm:hono-pino@^0.7.0",
    "hono-rate-limiter": "npm:hono-rate-limiter@^0.4.2",
    "@scalar/hono-api-reference": "npm:@scalar/hono-api-reference@^0.5.165",
    "zod": "npm:zod@^3.24.1",
    "drizzle-orm": "npm:drizzle-orm@^0.38.2",
    "drizzle-orm/": "npm:/drizzle-orm@^0.38.2/",
    "drizzle-kit": "npm:drizzle-kit@^0.30.1",
    "mysql2": "npm:mysql2@^3.11.5",
    "bcryptjs": "npm:bcryptjs@^2.4.3",
    "pino": "npm:pino@^9.5.0",
    "pino-pretty": "npm:pino-pretty@^13.0.0"
  },
  "fmt": { "semiColons": false, "singleQuote": true },
  "lint": { "rules": { "tags": ["recommended"] } },
  "compilerOptions": { "strict": true }
}
```

- [ ] **Step 3: Write `.gitignore`**

```
node_modules/
.env
dist/
```

- [ ] **Step 4: Write `.env.example`**

```
PORT=3000
LOG_LEVEL=debug
DATABASE_URL=mysql://app:app@localhost:3306/app
JWT_SECRET=dev-secret-change-me
ACCESS_TOKEN_TTL=900
REFRESH_TOKEN_TTL=2592000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/oauth/google/callback
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=100
# REDIS_URL=redis://localhost:6379
```

- [ ] **Step 5: Resolve deps and commit**

Run: `cp .env.example .env && deno cache --reload deno.json 2>/dev/null; deno install` (or `deno add` per package if a version fails to resolve).
Then:

```bash
git add .tool-versions deno.json deno.lock .gitignore .env.example
git commit -m "chore: scaffold Deno project tooling"
```

---

### Task 0.2: Config loader (`src/config.ts`)

**Files:**
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { assertEquals, assertThrows } from 'jsr:@std/assert'
import { loadConfig } from '../src/config.ts'

const base = {
  PORT: '3000',
  LOG_LEVEL: 'info',
  DATABASE_URL: 'mysql://app:app@localhost:3306/app',
  JWT_SECRET: 'secret',
  ACCESS_TOKEN_TTL: '900',
  REFRESH_TOKEN_TTL: '2592000',
  GOOGLE_CLIENT_ID: 'gid',
  GOOGLE_CLIENT_SECRET: 'gsecret',
  GOOGLE_REDIRECT_URI: 'http://localhost:3000/oauth/google/callback',
  RATE_LIMIT_WINDOW_MS: '60000',
  RATE_LIMIT_MAX: '100',
}

Deno.test('loadConfig parses and coerces env', () => {
  const cfg = loadConfig(base)
  assertEquals(cfg.port, 3000)
  assertEquals(cfg.accessTokenTtl, 900)
  assertEquals(cfg.redisUrl, undefined)
})

Deno.test('loadConfig throws on missing required value', () => {
  const { JWT_SECRET: _omit, ...partial } = base
  assertThrows(() => loadConfig(partial), Error, 'JWT_SECRET')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test -A tests/config.test.ts`
Expected: FAIL — module `../src/config.ts` not found.

- [ ] **Step 3: Implement `src/config.ts`**

```ts
import { z } from 'zod'

const schema = z.object({
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  ACCESS_TOKEN_TTL: z.coerce.number().default(900),
  REFRESH_TOKEN_TTL: z.coerce.number().default(2592000),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_REDIRECT_URI: z.string().default(''),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().default(100),
  REDIS_URL: z.string().optional(),
})

export type Config = {
  port: number
  logLevel: string
  databaseUrl: string
  jwtSecret: string
  accessTokenTtl: number
  refreshTokenTtl: number
  google: { clientId: string; clientSecret: string; redirectUri: string }
  rateLimit: { windowMs: number; max: number }
  redisUrl?: string
}

export function loadConfig(env: Record<string, string | undefined>): Config {
  const parsed = schema.safeParse(env)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => i.path.join('.')).join(', ')
    throw new Error(`Invalid configuration: ${issues}`)
  }
  const e = parsed.data
  return {
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    databaseUrl: e.DATABASE_URL,
    jwtSecret: e.JWT_SECRET,
    accessTokenTtl: e.ACCESS_TOKEN_TTL,
    refreshTokenTtl: e.REFRESH_TOKEN_TTL,
    google: {
      clientId: e.GOOGLE_CLIENT_ID,
      clientSecret: e.GOOGLE_CLIENT_SECRET,
      redirectUri: e.GOOGLE_REDIRECT_URI,
    },
    rateLimit: { windowMs: e.RATE_LIMIT_WINDOW_MS, max: e.RATE_LIMIT_MAX },
    redisUrl: e.REDIS_URL,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test -A tests/config.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add zod-validated config loader"
```

---

### Task 0.3: Errors lib (`src/lib/errors.ts`)

**Files:**
- Create: `src/lib/errors.ts`
- Test: `tests/errors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { assertEquals } from 'jsr:@std/assert'
import { AppError } from '../src/lib/errors.ts'

Deno.test('AppError.notFound sets status and code', () => {
  const err = AppError.notFound('user not found')
  assertEquals(err.status, 404)
  assertEquals(err.code, 'not_found')
  assertEquals(err.message, 'user not found')
})

Deno.test('AppError.conflict sets 409', () => {
  assertEquals(AppError.conflict('dup').status, 409)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test -A tests/errors.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/errors.ts`**

```ts
import type { ContentfulStatusCode } from 'hono/utils/http-status'

export class AppError extends Error {
  readonly status: ContentfulStatusCode
  readonly code: string

  constructor(status: ContentfulStatusCode, code: string, message: string) {
    super(message)
    this.name = 'AppError'
    this.status = status
    this.code = code
  }

  static badRequest = (m: string) => new AppError(400, 'bad_request', m)
  static unauthorized = (m: string) => new AppError(401, 'unauthorized', m)
  static forbidden = (m: string) => new AppError(403, 'forbidden', m)
  static notFound = (m: string) => new AppError(404, 'not_found', m)
  static conflict = (m: string) => new AppError(409, 'conflict', m)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test -A tests/errors.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/errors.ts tests/errors.test.ts
git commit -m "feat: add flat AppError with helper constructors"
```

---

### Task 0.4: Logger (`src/lib/logger.ts`) and app types (`src/types.ts`)

**Files:**
- Create: `src/lib/logger.ts`, `src/types.ts`

- [ ] **Step 1: Implement `src/lib/logger.ts`**

```ts
import { pino } from 'pino'
import type { Config } from '../config.ts'

export type Logger = pino.Logger

export function createLogger(config: Config): Logger {
  const isDev = config.logLevel === 'debug'
  return pino({
    level: config.logLevel,
    ...(isDev
      ? { transport: { target: 'pino-pretty', options: { colorize: true } } }
      : {}),
  })
}
```

- [ ] **Step 2: Implement `src/types.ts`** (placeholder types filled by later tasks; defined now so middleware/routes can import a stable `AppEnv`)

```ts
import type { Logger } from './lib/logger.ts'
import type { Config } from './config.ts'

export type AuthenticatedUser = {
  id: string
  email: string
  roles: string[]
  permissions: string[]
}

// Service + store interfaces are declared in their own files and re-exported
// into Deps in src/deps.ts. AppEnv is the single Hono env used everywhere.
export type AppVariables = {
  requestId: string
  logger: Logger
  config: Config
  user: AuthenticatedUser
}
```

> Note: `AppVariables` is extended with services + `rateStore` in Task 6.x once `Deps` exists. For now route/middleware files import `AppEnv` from `src/deps.ts` (created in Phase 1) — do not import service types until they exist.

- [ ] **Step 3: Typecheck and commit**

Run: `deno check src/lib/logger.ts src/types.ts`
Expected: PASS.

```bash
git add src/lib/logger.ts src/types.ts
git commit -m "feat: add pino logger factory and base app types"
```

---

### Task 0.5: Minimal app + health route + entrypoint

**Files:**
- Create: `src/app.ts`, `src/main.ts`
- Test: `tests/health.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { assertEquals } from 'jsr:@std/assert'
import { createApp } from '../src/app.ts'

Deno.test('GET /health returns ok', async () => {
  const app = createApp()
  const res = await app.request('/health')
  assertEquals(res.status, 200)
  assertEquals(await res.json(), { status: 'ok' })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test -A tests/health.test.ts`
Expected: FAIL — `src/app.ts` not found.

- [ ] **Step 3: Implement `src/app.ts`** (deps param optional for now; expanded in later phases)

```ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test -A tests/health.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement `src/main.ts`**

```ts
import { createApp } from './app.ts'
import { loadConfig } from './config.ts'

const config = loadConfig(Deno.env.toObject())
const app = createApp()

Deno.serve({ port: config.port }, app.fetch)
```

- [ ] **Step 6: Smoke-run and commit**

Run: `deno task check && deno test -A tests/health.test.ts`
Expected: PASS. (Optionally `deno task start` then `curl localhost:3000/health`.)

```bash
git add src/app.ts src/main.ts tests/health.test.ts
git commit -m "feat: minimal Hono app with health route and entrypoint"
```

---

## Phase 1 — Database, schema, migrations, seed

### Task 1.1: docker-compose (MySQL + optional Redis) and drizzle config

**Files:**
- Create: `docker-compose.yml`, `drizzle.config.ts`

- [ ] **Step 1: Write `docker-compose.yml`**

```yaml
services:
  mysql:
    image: mysql:8
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: app
      MYSQL_USER: app
      MYSQL_PASSWORD: app
    ports: ['3306:3306']
    healthcheck:
      test: ['CMD', 'mysqladmin', 'ping', '-h', 'localhost', '-uapp', '-papp']
      interval: 5s
      timeout: 5s
      retries: 10
  redis:
    image: redis:7
    profiles: ['redis']
    ports: ['6379:6379']
```

- [ ] **Step 2: Write `drizzle.config.ts`**

```ts
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'mysql',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dbCredentials: { url: Deno.env.get('DATABASE_URL')! },
})
```

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml drizzle.config.ts
git commit -m "chore: add MySQL/Redis compose and drizzle config"
```

---

### Task 1.2: Drizzle schema (`src/db/schema.ts`)

**Files:**
- Create: `src/db/schema.ts`

- [ ] **Step 1: Implement the schema** (users, refresh_tokens, social_accounts, RBAC tables)

```ts
import {
  datetime,
  mysqlTable,
  primaryKey,
  unique,
  varchar,
} from 'drizzle-orm/mysql-core'

export const users = mysqlTable('users', {
  id: varchar('id', { length: 36 }).primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }),
  createdAt: datetime('created_at').notNull(),
  updatedAt: datetime('updated_at').notNull(),
})

export const refreshTokens = mysqlTable('refresh_tokens', {
  id: varchar('id', { length: 36 }).primaryKey(),
  userId: varchar('user_id', { length: 36 }).notNull(),
  tokenHash: varchar('token_hash', { length: 64 }).notNull(),
  expiresAt: datetime('expires_at').notNull(),
  revokedAt: datetime('revoked_at'),
  replacedBy: varchar('replaced_by', { length: 36 }),
  createdAt: datetime('created_at').notNull(),
})

export const socialAccounts = mysqlTable('social_accounts', {
  id: varchar('id', { length: 36 }).primaryKey(),
  userId: varchar('user_id', { length: 36 }).notNull(),
  provider: varchar('provider', { length: 32 }).notNull(),
  providerAccountId: varchar('provider_account_id', { length: 255 }).notNull(),
  createdAt: datetime('created_at').notNull(),
}, (t) => ({
  providerAccount: unique().on(t.provider, t.providerAccountId),
}))

export const roles = mysqlTable('roles', {
  id: varchar('id', { length: 36 }).primaryKey(),
  name: varchar('name', { length: 64 }).notNull().unique(),
})

export const permissions = mysqlTable('permissions', {
  id: varchar('id', { length: 36 }).primaryKey(),
  key: varchar('key', { length: 64 }).notNull().unique(),
})

export const rolePermissions = mysqlTable('role_permissions', {
  roleId: varchar('role_id', { length: 36 }).notNull(),
  permissionId: varchar('permission_id', { length: 36 }).notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.roleId, t.permissionId] }) }))

export const userRoles = mysqlTable('user_roles', {
  userId: varchar('user_id', { length: 36 }).notNull(),
  roleId: varchar('role_id', { length: 36 }).notNull(),
}, (t) => ({ pk: primaryKey({ columns: [t.userId, t.roleId] }) }))
```

- [ ] **Step 2: Typecheck and generate the migration**

Run: `deno check src/db/schema.ts && docker compose up -d mysql && deno task db:generate`
Expected: a migration SQL file appears under `src/db/migrations/`.

- [ ] **Step 3: Commit**

```bash
git add src/db/schema.ts src/db/migrations
git commit -m "feat: add Drizzle MySQL schema and initial migration"
```

---

### Task 1.3: DB client (`src/db/client.ts`)

**Files:**
- Create: `src/db/client.ts`

- [ ] **Step 1: Implement**

```ts
import { drizzle } from 'drizzle-orm/mysql2'
import mysql from 'mysql2/promise'
import type { Config } from '../config.ts'
import * as schema from './schema.ts'

export type Database = ReturnType<typeof createDb>['db']

export function createDb(config: Config) {
  const pool = mysql.createPool(config.databaseUrl)
  const db = drizzle(pool, { schema, mode: 'default' })
  return { db, pool }
}
```

- [ ] **Step 2: Typecheck and commit**

Run: `deno check src/db/client.ts`
Expected: PASS.

```bash
git add src/db/client.ts
git commit -m "feat: add Drizzle MySQL client factory"
```

---

### Task 1.4: Seed roles & permissions (`src/db/seed.ts`)

**Files:**
- Create: `src/db/seed.ts`, `src/db/rbac-constants.ts`

- [ ] **Step 1: Implement `src/db/rbac-constants.ts`** (shared by seed + tests)

```ts
export const PERMISSIONS = {
  USERS_LIST: 'users:list',
  USERS_READ_ANY: 'users:read:any',
  USERS_UPDATE_ANY: 'users:update:any',
  USERS_DELETE_ANY: 'users:delete:any',
} as const

export const ROLE_USER = 'user'
export const ROLE_ADMIN = 'admin'

export const ROLE_GRANTS: Record<string, string[]> = {
  [ROLE_ADMIN]: Object.values(PERMISSIONS),
  [ROLE_USER]: [],
}
```

- [ ] **Step 2: Implement `src/db/seed.ts`**

```ts
import { loadConfig } from '../config.ts'
import { createDb } from './client.ts'
import { permissions, rolePermissions, roles } from './schema.ts'
import { PERMISSIONS, ROLE_GRANTS } from './rbac-constants.ts'

async function seed() {
  const config = loadConfig(Deno.env.toObject())
  const { db, pool } = createDb(config)

  const permRows = Object.values(PERMISSIONS).map((key) => ({
    id: crypto.randomUUID(),
    key,
  }))
  await db.insert(permissions).values(permRows).onDuplicateKeyUpdate({
    set: { key: permRows[0].key },
  })

  const permByKey = new Map(permRows.map((p) => [p.key, p.id]))

  for (const [roleName, keys] of Object.entries(ROLE_GRANTS)) {
    const roleId = crypto.randomUUID()
    await db.insert(roles).values({ id: roleId, name: roleName })
      .onDuplicateKeyUpdate({ set: { name: roleName } })
    // re-read role id in case it already existed
    const existing = await db.query.roles.findFirst({
      where: (r, { eq }) => eq(r.name, roleName),
    })
    const rid = existing?.id ?? roleId
    for (const key of keys) {
      const pid = permByKey.get(key)!
      await db.insert(rolePermissions).values({ roleId: rid, permissionId: pid })
        .onDuplicateKeyUpdate({ set: { roleId: rid } })
    }
  }

  await pool.end()
  console.log('seed complete')
}

if (import.meta.main) await seed()
```

- [ ] **Step 3: Run migration + seed against local MySQL**

Run: `deno task db:migrate && deno task db:seed`
Expected: prints `seed complete`; `roles`, `permissions`, `role_permissions` populated.

- [ ] **Step 4: Commit**

```bash
git add src/db/seed.ts src/db/rbac-constants.ts
git commit -m "feat: seed RBAC roles and permissions"
```

---

## Phase 2 — Users domain (repository pattern + register)

### Task 2.1: UserRepository interface + in-memory impl

**Files:**
- Create: `src/modules/users/users.repository.ts`
- Test: `tests/users-repository.test.ts`

- [ ] **Step 1: Write the failing test** (drives the in-memory impl, which is also the test fake)

```ts
import { assertEquals } from 'jsr:@std/assert'
import { createInMemoryUserRepository } from '../src/modules/users/users.repository.ts'

Deno.test('in-memory user repo create + findByEmail + access', async () => {
  const repo = createInMemoryUserRepository()
  const now = new Date()
  const user = await repo.create({
    id: 'u1',
    email: 'a@b.com',
    passwordHash: 'h',
    createdAt: now,
    updatedAt: now,
  })
  assertEquals(user.email, 'a@b.com')
  assertEquals((await repo.findByEmail('a@b.com'))?.id, 'u1')

  await repo.assignRole('u1', 'user')
  const access = await repo.findWithAccessById('u1')
  assertEquals(access?.roles, ['user'])
  assertEquals(access?.permissions, [])
})

Deno.test('in-memory user repo with seeded role grants permissions', async () => {
  const repo = createInMemoryUserRepository({
    admin: ['users:list', 'users:delete:any'],
  })
  const now = new Date()
  await repo.create({ id: 'u2', email: 'x@y.com', passwordHash: null, createdAt: now, updatedAt: now })
  await repo.assignRole('u2', 'admin')
  const access = await repo.findWithAccessById('u2')
  assertEquals(access?.permissions.sort(), ['users:delete:any', 'users:list'])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test -A tests/users-repository.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the interface + in-memory impl**

```ts
export type UserRecord = {
  id: string
  email: string
  passwordHash: string | null
  createdAt: Date
  updatedAt: Date
}

export type UserWithAccess = UserRecord & {
  roles: string[]
  permissions: string[]
}

export type UserRepository = {
  create(user: UserRecord): Promise<UserRecord>
  findById(id: string): Promise<UserRecord | null>
  findByEmail(email: string): Promise<UserRecord | null>
  findWithAccessById(id: string): Promise<UserWithAccess | null>
  update(id: string, patch: Partial<Pick<UserRecord, 'email' | 'passwordHash'>>): Promise<UserRecord | null>
  delete(id: string): Promise<boolean>
  list(): Promise<UserRecord[]>
  assignRole(userId: string, roleName: string): Promise<void>
}

// roleGrants maps roleName -> permission keys (mirrors seeded RBAC data).
export function createInMemoryUserRepository(
  roleGrants: Record<string, string[]> = { user: [] },
): UserRepository {
  const byId = new Map<string, UserRecord>()
  const userRoleNames = new Map<string, Set<string>>()

  return {
    create(user) {
      byId.set(user.id, { ...user })
      return Promise.resolve({ ...user })
    },
    findById(id) {
      return Promise.resolve(byId.has(id) ? { ...byId.get(id)! } : null)
    },
    findByEmail(email) {
      for (const u of byId.values()) if (u.email === email) return Promise.resolve({ ...u })
      return Promise.resolve(null)
    },
    findWithAccessById(id) {
      const u = byId.get(id)
      if (!u) return Promise.resolve(null)
      const roleNames = [...(userRoleNames.get(id) ?? [])]
      const perms = new Set<string>()
      for (const r of roleNames) for (const p of roleGrants[r] ?? []) perms.add(p)
      return Promise.resolve({ ...u, roles: roleNames, permissions: [...perms] })
    },
    update(id, patch) {
      const u = byId.get(id)
      if (!u) return Promise.resolve(null)
      const next = { ...u, ...patch, updatedAt: new Date() }
      byId.set(id, next)
      return Promise.resolve({ ...next })
    },
    delete(id) {
      return Promise.resolve(byId.delete(id))
    },
    list() {
      return Promise.resolve([...byId.values()].map((u) => ({ ...u })))
    },
    assignRole(userId, roleName) {
      const set = userRoleNames.get(userId) ?? new Set()
      set.add(roleName)
      userRoleNames.set(userId, set)
      return Promise.resolve()
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test -A tests/users-repository.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/users/users.repository.ts tests/users-repository.test.ts
git commit -m "feat: UserRepository interface with in-memory implementation"
```

---

### Task 2.2: Password lib (`src/lib/password.ts`)

**Files:**
- Create: `src/lib/password.ts`
- Test: `tests/password.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { assert, assertEquals } from 'jsr:@std/assert'
import { hashPassword, verifyPassword } from '../src/lib/password.ts'

Deno.test('hash + verify round-trips', async () => {
  const hash = await hashPassword('s3cret')
  assert(hash !== 's3cret')
  assertEquals(await verifyPassword('s3cret', hash), true)
  assertEquals(await verifyPassword('wrong', hash), false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test -A tests/password.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
import bcrypt from 'bcryptjs'

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10)
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `deno test -A tests/password.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/password.ts tests/password.test.ts
git commit -m "feat: add bcrypt password hashing helpers"
```

---

### Task 2.3: Users schema (Zod DTOs) + UserService (register/get/update/delete/list)

**Files:**
- Create: `src/modules/users/users.schema.ts`, `src/modules/users/users.service.ts`
- Test: `tests/users-service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { assertEquals, assertRejects } from 'jsr:@std/assert'
import { createInMemoryUserRepository } from '../src/modules/users/users.repository.ts'
import { createUserService } from '../src/modules/users/users.service.ts'
import { verifyPassword } from '../src/lib/password.ts'

function service() {
  const repo = createInMemoryUserRepository({ user: [] })
  return { repo, svc: createUserService({ repo }) }
}

Deno.test('register creates user with default role and hashed password', async () => {
  const { repo, svc } = service()
  const user = await svc.register({ email: 'a@b.com', password: 'pw123456' })
  assertEquals(user.email, 'a@b.com')
  const stored = await repo.findById(user.id)
  assertEquals(await verifyPassword('pw123456', stored!.passwordHash!), true)
  const access = await repo.findWithAccessById(user.id)
  assertEquals(access?.roles, ['user'])
})

Deno.test('register rejects duplicate email', async () => {
  const { svc } = service()
  await svc.register({ email: 'a@b.com', password: 'pw123456' })
  await assertRejects(() => svc.register({ email: 'a@b.com', password: 'pw123456' }), Error, 'conflict')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `deno test -A tests/users-service.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/modules/users/users.schema.ts`**

```ts
import { z } from 'zod'

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

export const updateUserSchema = z.object({
  email: z.string().email().optional(),
  password: z.string().min(8).optional(),
})

export const publicUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  createdAt: z.date(),
})

export type RegisterInput = z.infer<typeof registerSchema>
export type UpdateUserInput = z.infer<typeof updateUserSchema>
export type PublicUser = z.infer<typeof publicUserSchema>
```

- [ ] **Step 4: Implement `src/modules/users/users.service.ts`**

```ts
import type { UserRecord, UserRepository } from './users.repository.ts'
import type { PublicUser, RegisterInput, UpdateUserInput } from './users.schema.ts'
import { hashPassword } from '../../lib/password.ts'
import { AppError } from '../../lib/errors.ts'

export type UserService = ReturnType<typeof createUserService>

function toPublic(u: UserRecord): PublicUser {
  return { id: u.id, email: u.email, createdAt: u.createdAt }
}

export function createUserService(deps: { repo: UserRepository }) {
  const { repo } = deps
  return {
    async register(input: RegisterInput): Promise<PublicUser> {
      if (await repo.findByEmail(input.email)) {
        throw AppError.conflict('email already registered')
      }
      const now = new Date()
      const user = await repo.create({
        id: crypto.randomUUID(),
        email: input.email,
        passwordHash: await hashPassword(input.password),
        createdAt: now,
        updatedAt: now,
      })
      await repo.assignRole(user.id, 'user')
      return toPublic(user)
    },
    async getById(id: string): Promise<PublicUser> {
      const u = await repo.findById(id)
      if (!u) throw AppError.notFound('user not found')
      return toPublic(u)
    },
    async update(id: string, input: UpdateUserInput): Promise<PublicUser> {
      const patch: Partial<Pick<UserRecord, 'email' | 'passwordHash'>> = {}
      if (input.email) patch.email = input.email
      if (input.password) patch.passwordHash = await hashPassword(input.password)
      const u = await repo.update(id, patch)
      if (!u) throw AppError.notFound('user not found')
      return toPublic(u)
    },
    async remove(id: string): Promise<void> {
      if (!(await repo.delete(id))) throw AppError.notFound('user not found')
    },
    async list(): Promise<PublicUser[]> {
      return (await repo.list()).map(toPublic)
    },
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `deno test -A tests/users-service.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/modules/users/users.schema.ts src/modules/users/users.service.ts tests/users-service.test.ts
git commit -m "feat: add user Zod DTOs and UserService"
```

---

### Task 2.4: Deps + injectDeps + onError, wire register route, end-to-end test

**Files:**
- Create: `src/deps.ts`, `src/middleware/deps.ts`, `src/modules/users/users.routes.ts`, `tests/helpers.ts`
- Modify: `src/app.ts`, `src/types.ts`
- Test: `tests/users.test.ts`

> This task introduces the DI seam. `Deps` and `AppEnv` become the stable contract for all later phases.

- [ ] **Step 1: Implement `src/deps.ts`** (the `Deps` contract; `createDeps` grows as services exist)

```ts
import type { Config } from './config.ts'
import type { Database } from './db/client.ts'
import type { Logger } from './lib/logger.ts'
import type { AuthenticatedUser } from './types.ts'
import type { UserService } from './modules/users/users.service.ts'
import { createUserService } from './modules/users/users.service.ts'
import { createInMemoryUserRepository } from './modules/users/users.repository.ts'

export type Deps = {
  config: Config
  userService: UserService
  // authService + rateStore are added in later phases.
}

// NOTE: createDeps uses the in-memory repo here so this step typechecks before
// the Drizzle repo exists. Task 2.5 swaps in createDrizzleUserRepository(db).
export function createDeps(config: Config, _db: Database): Deps {
  const userRepo = createInMemoryUserRepository()
  return {
    config,
    userService: createUserService({ repo: userRepo }),
  }
}

export type AppEnv = {
  Variables:
    & { requestId: string; logger: Logger }
    & Deps
    & { user: AuthenticatedUser }
}
```

- [ ] **Step 2: Implement `src/middleware/deps.ts`**

```ts
import { createMiddleware } from 'hono/factory'
import type { Deps } from '../deps.ts'

export function injectDeps(deps: Deps) {
  return createMiddleware(async (c, next) => {
    for (const [key, value] of Object.entries(deps)) {
      c.set(key as keyof Deps, value as never)
    }
    await next()
  })
}
```

- [ ] **Step 3: Implement `src/modules/users/users.routes.ts`** (only the register route for now; protected routes added in Phase 3/4)

```ts
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
```

- [ ] **Step 4: Add `onError` and mount users in `src/app.ts`** — replace the file with a deps-taking version

```ts
import { Hono } from 'hono'
import { requestId } from 'hono/request-id'
import { secureHeaders } from 'hono/secure-headers'
import { cors } from 'hono/cors'
import { timeout } from 'hono/timeout'
import { HTTPException } from 'hono/http-exception'
import { pinoLogger } from 'hono-pino'
import type { AppEnv, Deps } from './deps.ts'
import { injectDeps } from './middleware/deps.ts'
import { createLogger } from './lib/logger.ts'
import { AppError } from './lib/errors.ts'
import users from './modules/users/users.routes.ts'

export function createApp(deps: Deps) {
  const logger = createLogger(deps.config)
  const app = new Hono<AppEnv>()
    .use('*', requestId())
    .use('*', pinoLogger({ pino: logger }))
    .use('*', secureHeaders())
    .use('*', cors())
    .use('*', timeout(15000))
    .use('*', injectDeps(deps))
    .get('/health', (c) => c.json({ status: 'ok' }))
    .route('/users', users)

  app.onError((err, c) => {
    if (err instanceof AppError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status)
    }
    if (err instanceof HTTPException) {
      return c.json({ error: { code: 'http_error', message: err.message } }, err.status)
    }
    return c.json({ error: { code: 'internal', message: 'Internal Server Error' } }, 500)
  })

  return app
}

export type AppType = ReturnType<typeof createApp>
```

> Update the existing `tests/health.test.ts` call to `createApp(makeTestDeps())` (helper below) so it still compiles.

- [ ] **Step 5: Implement `tests/helpers.ts`** (assembles in-memory Deps + the test app)

```ts
import type { Deps } from '../src/deps.ts'
import { createApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { createInMemoryUserRepository } from '../src/modules/users/users.repository.ts'
import { createUserService } from '../src/modules/users/users.service.ts'
import { ROLE_GRANTS } from '../src/db/rbac-constants.ts'

const testEnv = {
  DATABASE_URL: 'mysql://app:app@localhost:3306/app',
  JWT_SECRET: 'test-secret',
}

export function makeTestDeps(overrides: Partial<Deps> = {}): Deps {
  const config = loadConfig(testEnv)
  const userRepo = createInMemoryUserRepository(ROLE_GRANTS)
  return {
    config,
    userService: createUserService({ repo: userRepo }),
    ...overrides,
  }
}

export function makeTestApp(overrides: Partial<Deps> = {}) {
  return createApp(makeTestDeps(overrides))
}
```

- [ ] **Step 6: Write the failing route test `tests/users.test.ts`**

```ts
import { assertEquals } from 'jsr:@std/assert'
import { makeTestApp } from './helpers.ts'

Deno.test('POST /users registers a user', async () => {
  const app = makeTestApp()
  const res = await app.request('/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.com', password: 'pw123456' }),
  })
  assertEquals(res.status, 201)
  const body = await res.json()
  assertEquals(body.email, 'a@b.com')
})

Deno.test('POST /users validation error -> 400', async () => {
  const app = makeTestApp()
  const res = await app.request('/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'nope', password: 'x' }),
  })
  assertEquals(res.status, 400)
})
```

- [ ] **Step 7: Run, fix health test, verify all pass**

Run: `deno test -A tests/users.test.ts tests/health.test.ts`
Expected: PASS. (`tests/helpers.ts` is the only `makeTestDeps` source; `Deps` here intentionally omits `authService`/`rateStore` until later phases extend the type.)

- [ ] **Step 8: Commit**

```bash
git add src/deps.ts src/middleware/deps.ts src/modules/users/users.routes.ts src/app.ts tests/helpers.ts tests/users.test.ts tests/health.test.ts
git commit -m "feat: wire deps injection, onError, and register route"
```

---

### Task 2.5: Drizzle UserRepository implementation

**Files:**
- Create: `src/modules/users/users.repository.drizzle.ts`
- Test: covered by an integration test guarded behind `DATABASE_URL` (optional, runs only with MySQL up)

- [ ] **Step 1: Implement the Drizzle repo** (same `UserRepository` interface as the in-memory impl)

```ts
import { eq, inArray } from 'drizzle-orm'
import type { Database } from '../../db/client.ts'
import {
  permissions,
  rolePermissions,
  roles,
  userRoles,
  users,
} from '../../db/schema.ts'
import type { UserRecord, UserRepository, UserWithAccess } from './users.repository.ts'

export function createDrizzleUserRepository(db: Database): UserRepository {
  return {
    async create(user) {
      await db.insert(users).values(user)
      return user
    },
    async findById(id) {
      const row = await db.query.users.findFirst({ where: eq(users.id, id) })
      return row ?? null
    },
    async findByEmail(email) {
      const row = await db.query.users.findFirst({ where: eq(users.email, email) })
      return row ?? null
    },
    async findWithAccessById(id): Promise<UserWithAccess | null> {
      const user = await db.query.users.findFirst({ where: eq(users.id, id) })
      if (!user) return null
      const roleRows = await db.select({ id: roles.id, name: roles.name })
        .from(userRoles)
        .innerJoin(roles, eq(userRoles.roleId, roles.id))
        .where(eq(userRoles.userId, id))
      const roleIds = roleRows.map((r) => r.id)
      const permRows = roleIds.length
        ? await db.select({ key: permissions.key })
          .from(rolePermissions)
          .innerJoin(permissions, eq(rolePermissions.permissionId, permissions.id))
          .where(inArray(rolePermissions.roleId, roleIds))
        : []
      return {
        ...user,
        roles: roleRows.map((r) => r.name),
        permissions: [...new Set(permRows.map((p) => p.key))],
      }
    },
    async update(id, patch) {
      await db.update(users).set({ ...patch, updatedAt: new Date() }).where(eq(users.id, id))
      return this.findById(id)
    },
    async delete(id) {
      const [res] = await db.delete(users).where(eq(users.id, id))
      return (res as { affectedRows: number }).affectedRows > 0
    },
    async list() {
      return await db.select().from(users)
    },
    async assignRole(userId, roleName) {
      const role = await db.query.roles.findFirst({ where: eq(roles.name, roleName) })
      if (!role) throw new Error(`role ${roleName} not seeded`)
      await db.insert(userRoles).values({ userId, roleId: role.id })
        .onDuplicateKeyUpdate({ set: { userId } })
    },
  }
}
```

- [ ] **Step 2: Swap `createDeps` to use the Drizzle repo** (`src/deps.ts`)

Replace the in-memory placeholder from Task 2.4 with the real implementation:

```ts
import { createDrizzleUserRepository } from './modules/users/users.repository.drizzle.ts'
// ...
export function createDeps(config: Config, db: Database): Deps {
  const userRepo = createDrizzleUserRepository(db)
  return {
    config,
    userService: createUserService({ repo: userRepo }),
  }
}
```

Remove the now-unused `createInMemoryUserRepository` import from `src/deps.ts`.

- [ ] **Step 3: Typecheck**

Run: `deno check src/modules/users/users.repository.drizzle.ts src/deps.ts`
Expected: PASS.

- [ ] **Step 4: Optional integration test** `tests/users-repository.drizzle.test.ts` (skips when no DB)

```ts
import { assertEquals } from 'jsr:@std/assert'
import { loadConfig } from '../src/config.ts'
import { createDb } from '../src/db/client.ts'
import { createDrizzleUserRepository } from '../src/modules/users/users.repository.drizzle.ts'

const url = Deno.env.get('DATABASE_URL')

Deno.test({
  name: 'drizzle user repo create/find (needs MySQL + seed)',
  ignore: !url,
  fn: async () => {
    const { db, pool } = createDb(loadConfig(Deno.env.toObject()))
    const repo = createDrizzleUserRepository(db)
    const id = crypto.randomUUID()
    const now = new Date()
    await repo.create({ id, email: `${id}@b.com`, passwordHash: 'h', createdAt: now, updatedAt: now })
    await repo.assignRole(id, 'user')
    const access = await repo.findWithAccessById(id)
    assertEquals(access?.roles, ['user'])
    await repo.delete(id)
    await pool.end()
  },
})
```

- [ ] **Step 5: Run (with MySQL up + seeded) and commit**

Run: `deno test -A tests/users-repository.drizzle.test.ts`
Expected: PASS (or ignored if `DATABASE_URL` unset).

```bash
git add src/modules/users/users.repository.drizzle.ts tests/users-repository.drizzle.test.ts
git commit -m "feat: add Drizzle UserRepository implementation"
```

---

## Phase 3 — OAuth2 auth (password + refresh grants)

### Task 3.1: JWT + refresh-token libs

**Files:**
- Create: `src/lib/jwt.ts`, `src/lib/tokens.ts`
- Test: `tests/jwt.test.ts`, `tests/tokens.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/tokens.test.ts`:

```ts
import { assert, assertEquals } from 'jsr:@std/assert'
import { generateRefreshToken, hashToken } from '../src/lib/tokens.ts'

Deno.test('refresh token is opaque and hashable', () => {
  const token = generateRefreshToken()
  assert(token.length >= 32)
  const h = hashToken(token)
  assertEquals(h, hashToken(token))
  assert(h !== token)
})
```

`tests/jwt.test.ts`:

```ts
import { assertEquals } from 'jsr:@std/assert'
import { signAccessToken, verifyAccessToken } from '../src/lib/jwt.ts'

Deno.test('sign + verify access token', async () => {
  const token = await signAccessToken({ sub: 'u1', secret: 'sec', ttlSeconds: 900 })
  const payload = await verifyAccessToken(token, 'sec')
  assertEquals(payload.sub, 'u1')
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `deno test -A tests/tokens.test.ts tests/jwt.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/lib/tokens.ts`** (`hashToken` is async — `crypto.subtle` has no sync digest)

```ts
import { encodeHex } from 'jsr:@std/encoding/hex'

export function generateRefreshToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return encodeHex(bytes)
}

export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return encodeHex(new Uint8Array(digest))
}
```

The `tests/tokens.test.ts` above already `await`s `hashToken(token)`.

- [ ] **Step 4: Implement `src/lib/jwt.ts`**

```ts
import { sign, verify } from 'hono/jwt'

export type AccessPayload = { sub: string; exp: number }

export async function signAccessToken(
  opts: { sub: string; secret: string; ttlSeconds: number },
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + opts.ttlSeconds
  return await sign({ sub: opts.sub, exp }, opts.secret)
}

export async function verifyAccessToken(token: string, secret: string): Promise<AccessPayload> {
  return await verify(token, secret) as AccessPayload
}
```

- [ ] **Step 5: Run to verify pass; commit**

Run: `deno test -A tests/tokens.test.ts tests/jwt.test.ts`
Expected: PASS.

```bash
git add src/lib/jwt.ts src/lib/tokens.ts tests/jwt.test.ts tests/tokens.test.ts
git commit -m "feat: add JWT and opaque refresh-token helpers"
```

---

### Task 3.2: RefreshTokenRepository (interface + in-memory + drizzle)

**Files:**
- Create: `src/modules/auth/token.repository.ts`, `src/modules/auth/token.repository.drizzle.ts`
- Test: `tests/token-repository.test.ts`

- [ ] **Step 1: Write failing test (in-memory)**

```ts
import { assert, assertEquals } from 'jsr:@std/assert'
import { createInMemoryRefreshTokenRepository } from '../src/modules/auth/token.repository.ts'

Deno.test('store, find valid, rotate', async () => {
  const repo = createInMemoryRefreshTokenRepository()
  const future = new Date(Date.now() + 10000)
  await repo.create({ id: 't1', userId: 'u1', tokenHash: 'h1', expiresAt: future })
  assertEquals((await repo.findValidByHash('h1'))?.id, 't1')

  await repo.rotate('t1', { id: 't2', userId: 'u1', tokenHash: 'h2', expiresAt: future })
  assertEquals(await repo.findValidByHash('h1'), null) // revoked
  assert((await repo.findValidByHash('h2')) !== null)
})
```

- [ ] **Step 2: Run to verify fail**

Run: `deno test -A tests/token-repository.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/modules/auth/token.repository.ts`**

```ts
export type RefreshTokenRecord = {
  id: string
  userId: string
  tokenHash: string
  expiresAt: Date
  revokedAt?: Date | null
  replacedBy?: string | null
}

export type NewRefreshToken = Pick<RefreshTokenRecord, 'id' | 'userId' | 'tokenHash' | 'expiresAt'>

export type RefreshTokenRepository = {
  create(token: NewRefreshToken): Promise<void>
  findValidByHash(tokenHash: string): Promise<RefreshTokenRecord | null>
  rotate(oldId: string, next: NewRefreshToken): Promise<void>
  revoke(id: string): Promise<void>
  revokeAllForUser(userId: string): Promise<void>
}

export function createInMemoryRefreshTokenRepository(): RefreshTokenRepository {
  const byId = new Map<string, RefreshTokenRecord>()
  const isValid = (t: RefreshTokenRecord) => !t.revokedAt && t.expiresAt.getTime() > Date.now()

  return {
    create(token) {
      byId.set(token.id, { ...token, revokedAt: null, replacedBy: null })
      return Promise.resolve()
    },
    findValidByHash(tokenHash) {
      for (const t of byId.values()) {
        if (t.tokenHash === tokenHash && isValid(t)) return Promise.resolve({ ...t })
      }
      return Promise.resolve(null)
    },
    rotate(oldId, next) {
      const old = byId.get(oldId)
      if (old) byId.set(oldId, { ...old, revokedAt: new Date(), replacedBy: next.id })
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
```

- [ ] **Step 4: Implement `src/modules/auth/token.repository.drizzle.ts`**

```ts
import { and, eq, gt, isNull } from 'drizzle-orm'
import type { Database } from '../../db/client.ts'
import { refreshTokens } from '../../db/schema.ts'
import type { NewRefreshToken, RefreshTokenRepository } from './token.repository.ts'

export function createDrizzleRefreshTokenRepository(db: Database): RefreshTokenRepository {
  return {
    async create(token) {
      await db.insert(refreshTokens).values({ ...token, createdAt: new Date() })
    },
    async findValidByHash(tokenHash) {
      const row = await db.query.refreshTokens.findFirst({
        where: and(
          eq(refreshTokens.tokenHash, tokenHash),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, new Date()),
        ),
      })
      return row ?? null
    },
    async rotate(oldId, next) {
      await db.update(refreshTokens)
        .set({ revokedAt: new Date(), replacedBy: next.id })
        .where(eq(refreshTokens.id, oldId))
      await db.insert(refreshTokens).values({ ...next, createdAt: new Date() })
    },
    async revoke(id) {
      await db.update(refreshTokens).set({ revokedAt: new Date() }).where(eq(refreshTokens.id, id))
    },
    async revokeAllForUser(userId) {
      await db.update(refreshTokens).set({ revokedAt: new Date() }).where(
        eq(refreshTokens.userId, userId),
      )
    },
  }
}
```

- [ ] **Step 5: Run to verify pass; commit**

Run: `deno test -A tests/token-repository.test.ts && deno check src/modules/auth/token.repository.drizzle.ts`
Expected: PASS.

```bash
git add src/modules/auth/token.repository.ts src/modules/auth/token.repository.drizzle.ts tests/token-repository.test.ts
git commit -m "feat: add RefreshTokenRepository (in-memory + drizzle)"
```

---

### Task 3.3: AuthService (password grant, refresh grant, revoke)

**Files:**
- Create: `src/modules/auth/auth.schema.ts`, `src/modules/auth/auth.service.ts`
- Test: `tests/auth-service.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert'
import { createInMemoryUserRepository } from '../src/modules/users/users.repository.ts'
import { createInMemoryRefreshTokenRepository } from '../src/modules/auth/token.repository.ts'
import { createUserService } from '../src/modules/users/users.service.ts'
import { createAuthService } from '../src/modules/auth/auth.service.ts'
import { loadConfig } from '../src/config.ts'

function setup() {
  const config = loadConfig({ DATABASE_URL: 'x', JWT_SECRET: 'sec' })
  const userRepo = createInMemoryUserRepository({ user: [] })
  const tokenRepo = createInMemoryRefreshTokenRepository()
  const userService = createUserService({ repo: userRepo })
  const authService = createAuthService({ userRepo, tokenRepo, socialRepo: undefined as never, config })
  return { authService, userService }
}

Deno.test('password grant returns a token pair', async () => {
  const { authService, userService } = setup()
  await userService.register({ email: 'a@b.com', password: 'pw123456' })
  const pair = await authService.passwordGrant('a@b.com', 'pw123456')
  assert(pair.access_token.length > 0)
  assertEquals(pair.token_type, 'Bearer')
})

Deno.test('password grant rejects bad credentials', async () => {
  const { authService, userService } = setup()
  await userService.register({ email: 'a@b.com', password: 'pw123456' })
  await assertRejects(() => authService.passwordGrant('a@b.com', 'wrong'), Error, 'unauthorized')
})

Deno.test('refresh grant rotates the refresh token', async () => {
  const { authService, userService } = setup()
  await userService.register({ email: 'a@b.com', password: 'pw123456' })
  const first = await authService.passwordGrant('a@b.com', 'pw123456')
  const second = await authService.refreshGrant(first.refresh_token)
  assert(second.refresh_token !== first.refresh_token)
  await assertRejects(() => authService.refreshGrant(first.refresh_token), Error, 'unauthorized')
})
```

- [ ] **Step 2: Run to verify fail**

Run: `deno test -A tests/auth-service.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/modules/auth/auth.schema.ts`**

```ts
import { z } from 'zod'

export const tokenRequestSchema = z.discriminatedUnion('grant_type', [
  z.object({
    grant_type: z.literal('password'),
    username: z.string().email(),
    password: z.string().min(1),
  }),
  z.object({
    grant_type: z.literal('refresh_token'),
    refresh_token: z.string().min(1),
  }),
])

export const revokeSchema = z.object({ refresh_token: z.string().min(1) })

export type TokenRequest = z.infer<typeof tokenRequestSchema>
```

- [ ] **Step 4: Implement `src/modules/auth/auth.service.ts`**

```ts
import type { Config } from '../../config.ts'
import type { UserRepository } from '../users/users.repository.ts'
import type {
  NewRefreshToken,
  RefreshTokenRepository,
} from './token.repository.ts'
import type { SocialAccountRepository } from './social.repository.ts'
import { verifyPassword } from '../../lib/password.ts'
import { signAccessToken } from '../../lib/jwt.ts'
import { generateRefreshToken, hashToken } from '../../lib/tokens.ts'
import { AppError } from '../../lib/errors.ts'

export type TokenPair = {
  access_token: string
  refresh_token: string
  token_type: 'Bearer'
  expires_in: number
}

export type AuthService = ReturnType<typeof createAuthService>

export function createAuthService(deps: {
  userRepo: UserRepository
  tokenRepo: RefreshTokenRepository
  socialRepo: SocialAccountRepository
  config: Config
}) {
  const { userRepo, tokenRepo, config } = deps

  async function issueTokens(userId: string): Promise<TokenPair> {
    const access_token = await signAccessToken({
      sub: userId,
      secret: config.jwtSecret,
      ttlSeconds: config.accessTokenTtl,
    })
    const refresh = generateRefreshToken()
    const record: NewRefreshToken = {
      id: crypto.randomUUID(),
      userId,
      tokenHash: await hashToken(refresh),
      expiresAt: new Date(Date.now() + config.refreshTokenTtl * 1000),
    }
    await tokenRepo.create(record)
    return {
      access_token,
      refresh_token: refresh,
      token_type: 'Bearer',
      expires_in: config.accessTokenTtl,
    }
  }

  return {
    issueTokens,
    async passwordGrant(email: string, password: string): Promise<TokenPair> {
      const user = await userRepo.findByEmail(email)
      if (!user || !user.passwordHash) throw AppError.unauthorized('invalid credentials')
      if (!(await verifyPassword(password, user.passwordHash))) {
        throw AppError.unauthorized('invalid credentials')
      }
      return issueTokens(user.id)
    },
    async refreshGrant(refreshToken: string): Promise<TokenPair> {
      const hash = await hashToken(refreshToken)
      const existing = await tokenRepo.findValidByHash(hash)
      if (!existing) throw AppError.unauthorized('invalid refresh token')
      const refresh = generateRefreshToken()
      const next: NewRefreshToken = {
        id: crypto.randomUUID(),
        userId: existing.userId,
        tokenHash: await hashToken(refresh),
        expiresAt: new Date(Date.now() + config.refreshTokenTtl * 1000),
      }
      await tokenRepo.rotate(existing.id, next)
      const access_token = await signAccessToken({
        sub: existing.userId,
        secret: config.jwtSecret,
        ttlSeconds: config.accessTokenTtl,
      })
      return {
        access_token,
        refresh_token: refresh,
        token_type: 'Bearer',
        expires_in: config.accessTokenTtl,
      }
    },
    async revoke(refreshToken: string): Promise<void> {
      const existing = await tokenRepo.findValidByHash(await hashToken(refreshToken))
      if (existing) await tokenRepo.revoke(existing.id)
    },
    async resolveUser(userId: string) {
      const user = await userRepo.findWithAccessById(userId)
      if (!user) throw AppError.unauthorized('user not found')
      return { id: user.id, email: user.email, roles: user.roles, permissions: user.permissions }
    },
  }
}
```

> `socialRepo` is referenced in the constructor type now and used in Phase 5. The auth-service test passes `undefined as never` because none of the tested methods touch it.

- [ ] **Step 5: Run; the import of `./social.repository.ts` will fail — create a minimal stub now**

Create `src/modules/auth/social.repository.ts` with just the interface (impl in Phase 5):

```ts
export type SocialAccountRepository = {
  findByProviderAccount(provider: string, providerAccountId: string): Promise<{ userId: string } | null>
  link(account: { id: string; userId: string; provider: string; providerAccountId: string }): Promise<void>
}
```

- [ ] **Step 6: Run to verify pass; commit**

Run: `deno test -A tests/auth-service.test.ts`
Expected: PASS (3 tests).

```bash
git add src/modules/auth/auth.schema.ts src/modules/auth/auth.service.ts src/modules/auth/social.repository.ts tests/auth-service.test.ts
git commit -m "feat: add AuthService with password/refresh grants and revoke"
```

---

### Task 3.4: requireAuth middleware

**Files:**
- Create: `src/middleware/auth.ts`
- Test: covered via routes in Task 3.5

- [ ] **Step 1: Implement**

```ts
import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../deps.ts'
import { verifyAccessToken } from '../lib/jwt.ts'
import { AppError } from '../lib/errors.ts'

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) throw AppError.unauthorized('missing bearer token')
  const token = header.slice('Bearer '.length)
  let sub: string
  try {
    const payload = await verifyAccessToken(token, c.var.config.jwtSecret)
    sub = payload.sub
  } catch {
    throw AppError.unauthorized('invalid token')
  }
  const user = await c.var.authService.resolveUser(sub)
  c.set('user', user)
  await next()
})
```

- [ ] **Step 2: Typecheck and commit**

Run: `deno check src/middleware/auth.ts`
Expected: PASS (note: `c.var.authService` requires `Deps` to include `authService` — extend it in Task 3.5).

```bash
git add src/middleware/auth.ts
git commit -m "feat: add requireAuth middleware"
```

---

### Task 3.5: Extend Deps, auth routes, /users/me, end-to-end auth test

**Files:**
- Modify: `src/deps.ts`, `tests/helpers.ts`, `src/app.ts`, `src/modules/users/users.routes.ts`
- Create: `src/modules/auth/auth.routes.ts`
- Test: `tests/auth.test.ts`

- [ ] **Step 1: Extend `Deps` and `createDeps` in `src/deps.ts`**

Replace the `Deps` type and `createDeps` body:

```ts
import type { Config } from './config.ts'
import type { Database } from './db/client.ts'
import type { UserService } from './modules/users/users.service.ts'
import type { AuthService } from './modules/auth/auth.service.ts'
import type { AuthenticatedUser } from './types.ts'
import { createUserService } from './modules/users/users.service.ts'
import { createAuthService } from './modules/auth/auth.service.ts'
import { createDrizzleUserRepository } from './modules/users/users.repository.drizzle.ts'
import { createDrizzleRefreshTokenRepository } from './modules/auth/token.repository.drizzle.ts'
import { createDrizzleSocialAccountRepository } from './modules/auth/social.repository.drizzle.ts'

export type Deps = {
  config: Config
  userService: UserService
  authService: AuthService
}

export function createDeps(config: Config, db: Database): Deps {
  const userRepo = createDrizzleUserRepository(db)
  const tokenRepo = createDrizzleRefreshTokenRepository(db)
  const socialRepo = createDrizzleSocialAccountRepository(db)
  return {
    config,
    userService: createUserService({ repo: userRepo }),
    authService: createAuthService({ userRepo, tokenRepo, socialRepo, config }),
  }
}

export type AppEnv = {
  Variables: { requestId: string } & Deps & { user: AuthenticatedUser }
}
```

> Create `src/modules/auth/social.repository.drizzle.ts` as a stub now (full impl in Phase 5):

```ts
import type { Database } from '../../db/client.ts'
import type { SocialAccountRepository } from './social.repository.ts'

export function createDrizzleSocialAccountRepository(_db: Database): SocialAccountRepository {
  return {
    findByProviderAccount: () => Promise.resolve(null),
    link: () => Promise.resolve(),
  }
}
```

- [ ] **Step 2: Update `tests/helpers.ts`** to assemble the full Deps with in-memory repos

```ts
import type { Deps } from '../src/deps.ts'
import { createApp } from '../src/app.ts'
import { loadConfig } from '../src/config.ts'
import { createInMemoryUserRepository } from '../src/modules/users/users.repository.ts'
import { createInMemoryRefreshTokenRepository } from '../src/modules/auth/token.repository.ts'
import { createUserService } from '../src/modules/users/users.service.ts'
import { createAuthService } from '../src/modules/auth/auth.service.ts'
import { ROLE_GRANTS } from '../src/db/rbac-constants.ts'
import type { SocialAccountRepository } from '../src/modules/auth/social.repository.ts'

const testEnv = { DATABASE_URL: 'x', JWT_SECRET: 'test-secret' }

export function makeTestDeps(): { deps: Deps; userRepo: ReturnType<typeof createInMemoryUserRepository>; socialRepo: SocialAccountRepository } {
  const config = loadConfig(testEnv)
  const userRepo = createInMemoryUserRepository(ROLE_GRANTS)
  const tokenRepo = createInMemoryRefreshTokenRepository()
  const social = new Map<string, string>()
  const socialRepo: SocialAccountRepository = {
    findByProviderAccount: (p, id) => Promise.resolve(social.has(`${p}:${id}`) ? { userId: social.get(`${p}:${id}`)! } : null),
    link: (a) => { social.set(`${a.provider}:${a.providerAccountId}`, a.userId); return Promise.resolve() },
  }
  const deps: Deps = {
    config,
    userService: createUserService({ repo: userRepo }),
    authService: createAuthService({ userRepo, tokenRepo, socialRepo, config }),
  }
  return { deps, userRepo, socialRepo }
}

export function makeTestApp() {
  const { deps, userRepo } = makeTestDeps()
  return { app: createApp(deps), userRepo }
}

export async function authHeader(app: ReturnType<typeof createApp>, email: string, password: string) {
  const res = await app.request('/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'password', username: email, password }),
  })
  const body = await res.json()
  return { Authorization: `Bearer ${body.access_token}`, refresh: body.refresh_token as string }
}
```

> Update earlier tests (`tests/users.test.ts`, `tests/health.test.ts`) to destructure `const { app } = makeTestApp()`.

- [ ] **Step 3: Implement `src/modules/auth/auth.routes.ts`**

```ts
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
```

- [ ] **Step 4: Add `/users/me` to `src/modules/users/users.routes.ts`**

```ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import type { AppEnv } from '../../deps.ts'
import { registerSchema } from './users.schema.ts'
import { requireAuth } from '../../middleware/auth.ts'

const users = new Hono<AppEnv>()
  .post('/', zValidator('json', registerSchema), async (c) => {
    const user = await c.var.userService.register(c.req.valid('json'))
    return c.json(user, 201)
  })
  .get('/me', requireAuth, (c) => c.json(c.var.user, 200))

export default users
```

- [ ] **Step 5: Mount auth routes in `src/app.ts`**

Add the import and `.route('/oauth', auth)` after the users route:

```ts
import auth from './modules/auth/auth.routes.ts'
// ...
    .route('/users', users)
    .route('/oauth', auth)
```

- [ ] **Step 6: Write the end-to-end auth test `tests/auth.test.ts`**

```ts
import { assert, assertEquals } from 'jsr:@std/assert'
import { authHeader, makeTestApp } from './helpers.ts'

async function register(app: ReturnType<typeof makeTestApp>['app']) {
  await app.request('/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'a@b.com', password: 'pw123456' }),
  })
}

Deno.test('password grant then /users/me', async () => {
  const { app } = makeTestApp()
  await register(app)
  const { Authorization } = await authHeader(app, 'a@b.com', 'pw123456')
  const res = await app.request('/users/me', { headers: { Authorization } })
  assertEquals(res.status, 200)
  assertEquals((await res.json()).email, 'a@b.com')
})

Deno.test('refresh rotation + revoke', async () => {
  const { app } = makeTestApp()
  await register(app)
  const { refresh } = await authHeader(app, 'a@b.com', 'pw123456')

  const refreshed = await app.request('/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: refresh }),
  })
  assertEquals(refreshed.status, 200)
  const next = await refreshed.json()
  assert(next.refresh_token !== refresh)

  const revoke = await app.request('/oauth/revoke', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: next.refresh_token }),
  })
  assertEquals(revoke.status, 204)
})

Deno.test('/users/me without token -> 401', async () => {
  const { app } = makeTestApp()
  const res = await app.request('/users/me')
  assertEquals(res.status, 401)
})
```

- [ ] **Step 7: Run full suite; commit**

Run: `deno task check && deno test -A`
Expected: PASS (all tests).

```bash
git add src/deps.ts src/app.ts tests/helpers.ts tests/users.test.ts tests/health.test.ts src/modules/auth/auth.routes.ts src/modules/auth/social.repository.drizzle.ts src/modules/users/users.routes.ts tests/auth.test.ts
git commit -m "feat: OAuth2 token endpoint, /users/me, end-to-end auth"
```

---

## Phase 4 — RBAC (authorize middleware + protected user routes)

### Task 4.1: authorize middleware

**Files:**
- Create: `src/middleware/authorize.ts`
- Test: `tests/authorize.test.ts`

- [ ] **Step 1: Write failing test** (unit-test the middleware via a tiny app)

```ts
import { assertEquals } from 'jsr:@std/assert'
import { Hono } from 'hono'
import { requirePermission, requireSelfOrPermission } from '../src/middleware/authorize.ts'
import { AppError } from '../src/lib/errors.ts'

function appWith(user: { id: string; permissions: string[] }) {
  const app = new Hono()
    .use('*', async (c, next) => {
      c.set('user', { id: user.id, email: 'x', roles: [], permissions: user.permissions })
      await next()
    })
    .get('/list', requirePermission('users:list'), (c) => c.text('ok'))
    .get('/u/:id', requireSelfOrPermission('id', 'users:read:any'), (c) => c.text('ok'))
  app.onError((e, c) => e instanceof AppError ? c.json({ code: e.code }, e.status) : c.text('err', 500))
  return app
}

Deno.test('requirePermission allows/denies', async () => {
  assertEquals((await appWith({ id: 'u1', permissions: ['users:list'] }).request('/list')).status, 200)
  assertEquals((await appWith({ id: 'u1', permissions: [] }).request('/list')).status, 403)
})

Deno.test('requireSelfOrPermission: owner ok, other forbidden, override ok', async () => {
  assertEquals((await appWith({ id: 'u1', permissions: [] }).request('/u/u1')).status, 200)
  assertEquals((await appWith({ id: 'u1', permissions: [] }).request('/u/u2')).status, 403)
  assertEquals((await appWith({ id: 'u1', permissions: ['users:read:any'] }).request('/u/u2')).status, 200)
})
```

- [ ] **Step 2: Run to verify fail**

Run: `deno test -A tests/authorize.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `src/middleware/authorize.ts`**

```ts
import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../deps.ts'
import { AppError } from '../lib/errors.ts'

export function requirePermission(permission: string) {
  return createMiddleware<AppEnv>(async (c, next) => {
    if (!c.var.user.permissions.includes(permission)) {
      throw AppError.forbidden(`missing permission: ${permission}`)
    }
    await next()
  })
}

export function requireSelfOrPermission(paramName: string, permission: string) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const isSelf = c.req.param(paramName) === c.var.user.id
    if (!isSelf && !c.var.user.permissions.includes(permission)) {
      throw AppError.forbidden('not allowed')
    }
    await next()
  })
}
```

- [ ] **Step 4: Run to verify pass; commit**

Run: `deno test -A tests/authorize.test.ts`
Expected: PASS.

```bash
git add src/middleware/authorize.ts tests/authorize.test.ts
git commit -m "feat: add RBAC authorize middleware"
```

---

### Task 4.2: Protected user routes (list/get/update/delete) + RBAC test

**Files:**
- Modify: `src/modules/users/users.routes.ts`
- Test: `tests/rbac.test.ts`

- [ ] **Step 1: Extend `src/modules/users/users.routes.ts`** (full file)

```ts
import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import type { AppEnv } from '../../deps.ts'
import { registerSchema, updateUserSchema } from './users.schema.ts'
import { requireAuth } from '../../middleware/auth.ts'
import { requirePermission, requireSelfOrPermission } from '../../middleware/authorize.ts'

const users = new Hono<AppEnv>()
  .post('/', zValidator('json', registerSchema), async (c) => {
    const user = await c.var.userService.register(c.req.valid('json'))
    return c.json(user, 201)
  })
  .get('/me', requireAuth, (c) => c.json(c.var.user, 200))
  .get('/', requireAuth, requirePermission('users:list'), async (c) => {
    return c.json(await c.var.userService.list(), 200)
  })
  .get('/:id', requireAuth, requireSelfOrPermission('id', 'users:read:any'), async (c) => {
    return c.json(await c.var.userService.getById(c.req.param('id')), 200)
  })
  .patch(
    '/:id',
    requireAuth,
    requireSelfOrPermission('id', 'users:update:any'),
    zValidator('json', updateUserSchema),
    async (c) => {
      return c.json(await c.var.userService.update(c.req.param('id'), c.req.valid('json')), 200)
    },
  )
  .delete('/:id', requireAuth, requireSelfOrPermission('id', 'users:delete:any'), async (c) => {
    await c.var.userService.remove(c.req.param('id'))
    return c.body(null, 204)
  })

export default users
```

- [ ] **Step 2: Add a helper to grant admin in tests** — extend `tests/helpers.ts` `makeTestApp` to expose `userRepo` (already returned) and re-export `assignRole`. (No code change needed; `userRepo.assignRole` is already accessible.)

- [ ] **Step 3: Write `tests/rbac.test.ts`**

```ts
import { assertEquals } from 'jsr:@std/assert'
import { authHeader, makeTestApp } from './helpers.ts'

async function registerAndId(app: ReturnType<typeof makeTestApp>['app'], email: string) {
  const res = await app.request('/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'pw123456' }),
  })
  return (await res.json()).id as string
}

Deno.test('non-admin cannot list users', async () => {
  const { app } = makeTestApp()
  await registerAndId(app, 'a@b.com')
  const { Authorization } = await authHeader(app, 'a@b.com', 'pw123456')
  assertEquals((await app.request('/users', { headers: { Authorization } })).status, 403)
})

Deno.test('admin can list users', async () => {
  const { app, userRepo } = makeTestApp()
  const id = await registerAndId(app, 'admin@b.com')
  await userRepo.assignRole(id, 'admin')
  const { Authorization } = await authHeader(app, 'admin@b.com', 'pw123456')
  assertEquals((await app.request('/users', { headers: { Authorization } })).status, 200)
})

Deno.test('user can read self but not others; admin can read others', async () => {
  const { app, userRepo } = makeTestApp()
  const aId = await registerAndId(app, 'a@b.com')
  const bId = await registerAndId(app, 'b@b.com')
  const aAuth = await authHeader(app, 'a@b.com', 'pw123456')
  assertEquals((await app.request(`/users/${aId}`, { headers: { Authorization: aAuth.Authorization } })).status, 200)
  assertEquals((await app.request(`/users/${bId}`, { headers: { Authorization: aAuth.Authorization } })).status, 403)

  await userRepo.assignRole(aId, 'admin')
  const aAdmin = await authHeader(app, 'a@b.com', 'pw123456')
  assertEquals((await app.request(`/users/${bId}`, { headers: { Authorization: aAdmin.Authorization } })).status, 200)
})
```

- [ ] **Step 4: Run; commit**

Run: `deno task check && deno test -A tests/rbac.test.ts`
Expected: PASS.

```bash
git add src/modules/users/users.routes.ts tests/rbac.test.ts
git commit -m "feat: RBAC-protected user CRUD routes"
```

---

## Phase 5 — Google social login

### Task 5.1: SocialAccountRepository (drizzle impl) + loginWithGoogle service method

**Files:**
- Modify: `src/modules/auth/social.repository.drizzle.ts`, `src/modules/auth/auth.service.ts`
- Test: `tests/social-login.test.ts`

- [ ] **Step 1: Write failing test** (service-level, stubbed profile)

```ts
import { assert, assertEquals } from 'jsr:@std/assert'
import { makeTestDeps } from './helpers.ts'

Deno.test('loginWithGoogle creates + links a new user, issues tokens', async () => {
  const { deps, userRepo } = makeTestDeps()
  const pair = await deps.authService.loginWithGoogle({
    providerAccountId: 'g-123',
    email: 'g@b.com',
  })
  assert(pair.access_token.length > 0)
  const user = await userRepo.findByEmail('g@b.com')
  assertEquals(user?.passwordHash, null)
})

Deno.test('loginWithGoogle is idempotent for the same google account', async () => {
  const { deps, userRepo } = makeTestDeps()
  await deps.authService.loginWithGoogle({ providerAccountId: 'g-1', email: 'g@b.com' })
  await deps.authService.loginWithGoogle({ providerAccountId: 'g-1', email: 'g@b.com' })
  const all = await userRepo.list()
  assertEquals(all.filter((u) => u.email === 'g@b.com').length, 1)
})
```

> `makeTestDeps` must return `{ deps, userRepo }` — already does from Task 3.5.

- [ ] **Step 2: Run to verify fail**

Run: `deno test -A tests/social-login.test.ts`
Expected: FAIL — `loginWithGoogle` not defined.

- [ ] **Step 3: Add `loginWithGoogle` to `src/modules/auth/auth.service.ts`** (inside the returned object)

```ts
    async loginWithGoogle(profile: { providerAccountId: string; email: string }): Promise<TokenPair> {
      const existing = await deps.socialRepo.findByProviderAccount('google', profile.providerAccountId)
      if (existing) return issueTokens(existing.userId)

      let user = await userRepo.findByEmail(profile.email)
      if (!user) {
        const now = new Date()
        user = await userRepo.create({
          id: crypto.randomUUID(),
          email: profile.email,
          passwordHash: null,
          createdAt: now,
          updatedAt: now,
        })
        await userRepo.assignRole(user.id, 'user')
      }
      await deps.socialRepo.link({
        id: crypto.randomUUID(),
        userId: user.id,
        provider: 'google',
        providerAccountId: profile.providerAccountId,
      })
      return issueTokens(user.id)
    },
```

- [ ] **Step 4: Implement the real Drizzle social repo** (`src/modules/auth/social.repository.drizzle.ts`)

```ts
import { and, eq } from 'drizzle-orm'
import type { Database } from '../../db/client.ts'
import { socialAccounts } from '../../db/schema.ts'
import type { SocialAccountRepository } from './social.repository.ts'

export function createDrizzleSocialAccountRepository(db: Database): SocialAccountRepository {
  return {
    async findByProviderAccount(provider, providerAccountId) {
      const row = await db.query.socialAccounts.findFirst({
        where: and(
          eq(socialAccounts.provider, provider),
          eq(socialAccounts.providerAccountId, providerAccountId),
        ),
      })
      return row ? { userId: row.userId } : null
    },
    async link(account) {
      await db.insert(socialAccounts).values({ ...account, createdAt: new Date() })
    },
  }
}
```

- [ ] **Step 5: Run to verify pass; commit**

Run: `deno test -A tests/social-login.test.ts && deno check src/modules/auth/social.repository.drizzle.ts`
Expected: PASS.

```bash
git add src/modules/auth/auth.service.ts src/modules/auth/social.repository.drizzle.ts tests/social-login.test.ts
git commit -m "feat: Google account linking + loginWithGoogle token issuance"
```

---

### Task 5.2: Google OAuth routes

**Files:**
- Modify: `src/modules/auth/auth.routes.ts`

- [ ] **Step 1: Add the Google routes** (append to the chained `auth` app)

```ts
import { googleAuth } from '@hono/oauth-providers/google'
// ...
  .use('/google/*', (c, next) => {
    return googleAuth({
      client_id: c.var.config.google.clientId,
      client_secret: c.var.config.google.clientSecret,
      redirect_uri: c.var.config.google.redirectUri,
      scope: ['openid', 'email', 'profile'],
    })(c, next)
  })
  .get('/google', (c) => c.redirect('/oauth/google/callback'))
  .get('/google/callback', async (c) => {
    const profile = c.get('user-google') as { id: string; email: string } | undefined
    if (!profile?.email) return c.json({ error: { code: 'oauth_failed', message: 'no profile' } }, 401)
    const pair = await c.var.authService.loginWithGoogle({
      providerAccountId: profile.id,
      email: profile.email,
    })
    return c.json(pair, 200)
  })
```

> The `googleAuth` middleware both starts the flow and handles the callback. `GET /oauth/google` simply enters the middleware path. The provider sets `c.get('user-google')` with the verified profile. Real credentials in `.env` are required to exercise this manually; the unit test in 5.1 covers the service logic without a live round-trip.

- [ ] **Step 2: Typecheck and manual smoke (optional, needs real Google creds)**

Run: `deno check src/modules/auth/auth.routes.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/modules/auth/auth.routes.ts
git commit -m "feat: add Google social-login routes"
```

---

## Phase 6 — Rate limiting

### Task 6.1: RateLimitStore (interface + memory impl) and middleware

**Files:**
- Create: `src/lib/rate-limit-store.ts`, `src/middleware/rate-limit.ts`
- Modify: `src/deps.ts`, `src/types.ts`, `tests/helpers.ts`, `src/app.ts`
- Test: `tests/rate-limit.test.ts`

- [ ] **Step 1: Implement `src/lib/rate-limit-store.ts`** (memory store implementing `hono-rate-limiter`'s `Store` shape; Redis impl stubbed with a TODO-free guard)

```ts
import type { Store } from 'hono-rate-limiter'

export type RateLimitStore = Store

export function createMemoryRateLimitStore(): RateLimitStore {
  const hits = new Map<string, { count: number; resetAt: number }>()
  let windowMs = 60000

  return {
    init(opts) {
      windowMs = opts.windowMs
    },
    increment(key) {
      const now = Date.now()
      const entry = hits.get(key)
      if (!entry || entry.resetAt <= now) {
        const fresh = { count: 1, resetAt: now + windowMs }
        hits.set(key, fresh)
        return Promise.resolve({ totalHits: 1, resetTime: new Date(fresh.resetAt) })
      }
      entry.count++
      return Promise.resolve({ totalHits: entry.count, resetTime: new Date(entry.resetAt) })
    },
    decrement(key) {
      const entry = hits.get(key)
      if (entry && entry.count > 0) entry.count--
    },
    resetKey(key) {
      hits.delete(key)
    },
  }
}

export function createRedisRateLimitStore(_redisUrl: string): RateLimitStore {
  // The Redis-backed store is provided as an optional production swap.
  // It uses the same Store contract; wire a redis client here.
  throw new Error('Redis rate-limit store not configured in this environment')
}
```

> Verify the exact `Store` method signatures against the installed `hono-rate-limiter` version and adjust (`init/increment/decrement/resetKey`). If the version differs, match its `Store` interface — the memory semantics above stay the same.

- [ ] **Step 2: Implement `src/middleware/rate-limit.ts`**

```ts
import { rateLimiter } from 'hono-rate-limiter'
import type { AppEnv } from '../deps.ts'
import type { RateLimitStore } from '../lib/rate-limit-store.ts'

export function makeRateLimiter(
  store: RateLimitStore,
  opts: { windowMs: number; limit: number },
) {
  return rateLimiter<AppEnv>({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: 'draft-6',
    keyGenerator: (c) =>
      c.var.user?.id ??
        c.req.header('x-forwarded-for') ??
        'anonymous',
    store,
  })
}
```

- [ ] **Step 3: Add `rateStore` to `Deps`/`createDeps`** (`src/deps.ts`) and `AppVariables` (`src/types.ts`)

In `src/deps.ts` add import + field:

```ts
import type { RateLimitStore } from './lib/rate-limit-store.ts'
import { createMemoryRateLimitStore, createRedisRateLimitStore } from './lib/rate-limit-store.ts'
// in Deps:
  rateStore: RateLimitStore
// in createDeps return:
  rateStore: config.redisUrl ? createRedisRateLimitStore(config.redisUrl) : createMemoryRateLimitStore(),
```

In `tests/helpers.ts` add `rateStore: createMemoryRateLimitStore()` to the `deps` object (import the factory).

- [ ] **Step 4: Apply limiters in `src/app.ts`**

```ts
import { makeRateLimiter } from './middleware/rate-limit.ts'
// global, lenient:
    .use('*', makeRateLimiter(deps.rateStore, {
      windowMs: deps.config.rateLimit.windowMs,
      limit: deps.config.rateLimit.max,
    }))
// stricter on auth: mount before .route('/oauth', auth)
    .use('/oauth/token', makeRateLimiter(deps.rateStore, { windowMs: deps.config.rateLimit.windowMs, limit: 10 }))
```

- [ ] **Step 5: Write `tests/rate-limit.test.ts`** (uses a tiny dedicated app with limit=2 to stay deterministic)

```ts
import { assertEquals } from 'jsr:@std/assert'
import { Hono } from 'hono'
import { createMemoryRateLimitStore } from '../src/lib/rate-limit-store.ts'
import { makeRateLimiter } from '../src/middleware/rate-limit.ts'

Deno.test('limiter blocks after the configured number of hits', async () => {
  const app = new Hono()
    .use('*', (c, next) => { c.set('user', undefined as never); return next() })
    .use('*', makeRateLimiter(createMemoryRateLimitStore(), { windowMs: 60000, limit: 2 }))
    .get('/', (c) => c.text('ok'))

  assertEquals((await app.request('/', { headers: { 'x-forwarded-for': '1.1.1.1' } })).status, 200)
  assertEquals((await app.request('/', { headers: { 'x-forwarded-for': '1.1.1.1' } })).status, 200)
  assertEquals((await app.request('/', { headers: { 'x-forwarded-for': '1.1.1.1' } })).status, 429)
})
```

- [ ] **Step 6: Run; commit**

Run: `deno task check && deno test -A tests/rate-limit.test.ts && deno test -A`
Expected: PASS (whole suite — confirm global limiter's default 100 limit doesn't trip existing tests; if any test makes >100 requests, raise the test env limit).

```bash
git add src/lib/rate-limit-store.ts src/middleware/rate-limit.ts src/deps.ts src/types.ts tests/helpers.ts src/app.ts tests/rate-limit.test.ts
git commit -m "feat: pluggable rate limiting (memory store) with auth throttle"
```

---

## Phase 7 — OpenAPI + Scalar docs

### Task 7.1: Describe routes and serve spec + Scalar UI

**Files:**
- Modify: `src/modules/users/users.routes.ts`, `src/modules/auth/auth.routes.ts`, `src/app.ts`
- Test: `tests/openapi.test.ts`

- [ ] **Step 1: Write failing test**

```ts
import { assert, assertEquals } from 'jsr:@std/assert'
import { makeTestApp } from './helpers.ts'

Deno.test('serves an OpenAPI document', async () => {
  const { app } = makeTestApp()
  const res = await app.request('/openapi')
  assertEquals(res.status, 200)
  const doc = await res.json()
  assert(doc.openapi.startsWith('3'))
  assert(doc.paths['/users'])
})

Deno.test('serves Scalar docs page', async () => {
  const { app } = makeTestApp()
  const res = await app.request('/docs')
  assertEquals(res.status, 200)
  assert((res.headers.get('content-type') ?? '').includes('text/html'))
})
```

- [ ] **Step 2: Run to verify fail**

Run: `deno test -A tests/openapi.test.ts`
Expected: FAIL — `/openapi` 404.

- [ ] **Step 3: Add `describeRoute` to the register route** (`src/modules/users/users.routes.ts`) — annotate at least one route so paths populate

```ts
import { describeRoute } from 'hono-openapi'
// chain onto POST '/':
  .post(
    '/',
    describeRoute({
      description: 'Register a new user',
      responses: { 201: { description: 'Created' }, 400: { description: 'Invalid' } },
    }),
    zValidator('json', registerSchema),
    async (c) => {
      const user = await c.var.userService.register(c.req.valid('json'))
      return c.json(user, 201)
    },
  )
```

- [ ] **Step 4: Register the spec + Scalar in `src/app.ts`**

```ts
import { openAPISpecs } from 'hono-openapi'
import { apiReference } from '@scalar/hono-api-reference'
// after routes are mounted:
  app.get('/openapi', openAPISpecs(app, {
    documentation: { info: { title: 'API Boilerplate', version: '1.0.0', description: 'Hono + Deno boilerplate' } },
  }))
  app.get('/docs', apiReference({ spec: { url: '/openapi' } }))
```

> `openAPISpecs(app, …)` must be called after all `.route()` mounts so it can introspect the registered paths. Place it just before `app.onError`.

- [ ] **Step 5: Run to verify pass; commit**

Run: `deno test -A tests/openapi.test.ts`
Expected: PASS.

```bash
git add src/modules/users/users.routes.ts src/app.ts tests/openapi.test.ts
git commit -m "feat: serve OpenAPI spec and Scalar docs"
```

---

## Phase 8 — RPC client export

### Task 8.1: Export `hc` client typed by `AppType`

**Files:**
- Create: `src/client.ts`
- Test: `tests/client.test.ts`

- [ ] **Step 1: Write failing test** (drive the client against the in-process app via the `fetch` option)

```ts
import { assertEquals } from 'jsr:@std/assert'
import { hc } from 'hono/client'
import type { AppType } from '../src/app.ts'
import { makeTestApp } from './helpers.ts'

Deno.test('typed client hits /health', async () => {
  const { app } = makeTestApp()
  const client = hc<AppType>('http://local.test', { fetch: app.request })
  const res = await client.health.$get()
  assertEquals(res.status, 200)
  assertEquals(await res.json(), { status: 'ok' })
})
```

- [ ] **Step 2: Run to verify fail**

Run: `deno test -A tests/client.test.ts`
Expected: FAIL — `src/client.ts` missing (and confirm `.health.$get` type resolves; if not, ensure routes are chained without `Hono` return annotations).

- [ ] **Step 3: Implement `src/client.ts`**

```ts
import { hc } from 'hono/client'
import type { AppType } from './app.ts'

export type { AppType }

export function createClient(baseUrl: string, init?: Parameters<typeof hc>[1]) {
  return hc<AppType>(baseUrl, init)
}
```

- [ ] **Step 4: Run to verify pass; commit**

Run: `deno test -A tests/client.test.ts && deno task check`
Expected: PASS.

```bash
git add src/client.ts tests/client.test.ts
git commit -m "feat: export type-safe hc RPC client"
```

---

## Phase 9 — Pre-commit hooks (husky + gitleaks) and README

### Task 9.1: husky + gitleaks pre-commit

**Files:**
- Create: `package.json`, `.husky/pre-commit`, `.gitleaks.toml`

- [ ] **Step 1: Write `package.json`** (husky only)

```json
{
  "name": "api-boilerplate-hooks",
  "private": true,
  "scripts": { "prepare": "husky" },
  "devDependencies": { "husky": "^9.1.7" }
}
```

- [ ] **Step 2: Install husky**

Run: `npm install && npx husky init`
Expected: creates `.husky/` and a sample `pre-commit`.

- [ ] **Step 3: Write `.husky/pre-commit`**

```sh
gitleaks protect --staged --redact || exit 1
deno fmt --check || exit 1
deno lint || exit 1
deno check src/ tests/ || exit 1
```

- [ ] **Step 4: Write `.gitleaks.toml`**

```toml
title = "gitleaks config"
[extend]
useDefault = true

[allowlist]
description = "Ignore local env example"
paths = ['''\.env\.example''']
```

- [ ] **Step 5: Verify the hook fires**

Run: `git add -A && git commit -m "test"` (should run all four checks). If gitleaks is installed via asdf and all checks pass, amend/redo the real commit below.
Expected: checks run; commit proceeds when clean.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json .husky/pre-commit .gitleaks.toml
git commit -m "chore: add husky pre-commit running gitleaks + deno checks"
```

> Note: husky's `prepare` script writes `core.hooksPath=.husky/_`. Since `node_modules/` is gitignored, contributors run `npm install` once after clone. `.gitignore` already excludes `node_modules/`.

---

### Task 9.2: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`** covering: prerequisites (asdf, docker), `asdf install`, `cp .env.example .env`, `docker compose up -d mysql`, `deno task db:migrate`, `deno task db:seed`, `deno task dev`, the endpoint table, `deno task test`, `deno task check:all`, and how to enable Redis (`docker compose --profile redis up -d` + set `REDIS_URL`). Document Google OAuth env setup and the `/docs` Scalar URL.

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with setup and usage"
```

---

## Final verification

- [ ] **Run the whole gate**

Run: `deno task check:all && deno test -A`
Expected: fmt clean, lint clean, types clean, all tests pass.

- [ ] **Manual smoke (with MySQL up + seeded)**

Run: `deno task db:migrate && deno task db:seed && deno task dev`, then:
- `curl localhost:3000/health` → `{"status":"ok"}`
- register → `POST /users`
- `POST /oauth/token` (password grant) → token pair
- `GET /users/me` with bearer → current user
- open `localhost:3000/docs` → Scalar UI

---

## Notes on sequencing & risk

- **Cross-phase type seam:** `Deps`/`AppEnv` grow over Phases 2→6. Each task that extends them updates `tests/helpers.ts` in the same task, so the suite stays green. Never leave `Deps` referenced but unset in `injectDeps`.
- **RPC inference:** never annotate a route module or `createApp` with an explicit `Hono`/return type — inference is what powers `hc<AppType>` (Task 8.1 fails loudly if a route breaks it).
- **Library API drift:** `hono-rate-limiter` `Store`, `hono-openapi` `openAPISpecs`/`describeRoute`, `@hono/oauth-providers` `googleAuth`/`user-google`, and `hono-pino` (the `pinoLogger` option name and the `c.var.logger` wrapper type vs. `pino.Logger`) are the most version-sensitive surfaces. Verify each against the installed version when its task starts; the surrounding architecture does not change if signatures differ. If `hono-pino`'s context logger type doesn't match `pino.Logger`, set `AppEnv.Variables.logger` to the type it exports.
- **DB-touching tests** (`*.drizzle.test.ts`) are `ignore`d without `DATABASE_URL`; all core logic is covered by in-memory tests that need no MySQL.
