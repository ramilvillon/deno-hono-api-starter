# Design: TypeScript + Hono + Deno REST API Boilerplate

**Date:** 2026-06-19
**Status:** Approved

## Goal

A production-shaped REST API boilerplate built on Deno + Hono + TypeScript that
demonstrates clean, testable structure using **composition over inheritance**. It
ships a Users domain with OAuth2 authentication (access + refresh tokens), Google
social login, role-based access control with ownership checks, configurable rate
limiting, MySQL persistence via Drizzle, generated OpenAPI docs, an end-to-end
type-safe RPC client, and pre-commit security checks.

## Guiding Principles

- **Composition over inheritance.** No base classes or inheritance hierarchies.
  Every unit is a factory function that receives its dependencies and returns a
  plain object (or a Hono sub-app). Wiring happens once at the entrypoint.
- **Hono best practices ("Building a larger application").** Each route group is
  its own file as a **module-level, method-chained** `new Hono<{ Variables }>()`
  that is `export`ed and mounted in the parent with `app.route('/path', module)`.
  No Rails-style controllers and no wrapping route files in factory functions —
  chaining is what preserves type inference and the `hc` RPC client. Do not
  annotate the exported route/app types (leave them inferred).
- **Dependencies via context, not constructors.** Because route modules are
  dependency-free, services and repositories are supplied through a single
  `injectDeps(deps)` middleware that sets them on `c.var` (typed in `Variables`).
  Route handlers read `c.var.userService` etc. This keeps the Hono idiom intact
  while remaining composition-based and testable (build the app with
  in-memory-backed deps).
- **Testable by construction.** Domain logic depends on repository *interfaces*,
  so tests inject in-memory fakes and run without a database.
- **YAGNI.** A single Users domain carries auth, RBAC, social login, and rate
  limiting; these cross-cutting concerns are the boilerplate's reason to exist, so
  they ship, but no second business domain is added just to demonstrate structure.

## Stack

| Concern        | Choice |
|----------------|--------|
| Version manager| asdf (`.tool-versions` pins deno, nodejs, gitleaks) |
| Runtime        | Deno 2.7.13 (`deno.json` import map, tasks, fmt/lint, `--env-file`) |
| Framework      | Hono |
| Validation     | Zod + `@hono/zod-validator` |
| Database       | Drizzle ORM + **MySQL 8** (`drizzle-orm/mysql2`, `mysql2` driver) |
| Migrations     | `drizzle-kit` (`dialect: "mysql"`) |
| Auth           | OAuth2 access (JWT) + refresh tokens (opaque, stored & rotated) |
| Social login   | `@hono/oauth-providers` (Google authorization-code flow) |
| Authorization  | RBAC: roles + permissions + ownership (`requirePermission`) |
| Rate limiting  | `hono-rate-limiter` behind a pluggable store (memory default, Redis optional) |
| Logging        | `hono-pino` (structured JSON via pino) + request-scoped logger |
| API docs       | `hono-openapi` (spec from Zod) + Scalar UI |
| Tests          | `Deno.test` + `app.request()` with in-memory repo fakes |
| RPC client     | Hono `hc<AppType>` |
| Git hooks      | husky v9 + gitleaks + deno fmt/lint/check |

## Architecture

### Layered composition (dependencies flow inward)

```
config → db → repositories → services ─┐ (assembled by createDeps)
                                       └→ deps
deps → injectDeps middleware → route modules → app → serve
```

Repositories and services are factory functions; route modules follow Hono's
"Building a larger application" idiom (module-level chained sub-apps):

- **config** — `loadConfig(env): Config`, validated with Zod. Fails fast on bad env.
- **db** — `createDb(config): Database` returns a Drizzle MySQL instance.
- **repository** — interface + factory implementations (see below).
- **service** — business logic factory, throws typed `AppError`.
- **deps** — `createDeps(config, db): Deps` assembles repositories + services into
  one plain object (the composition root's payload).
- **injectDeps** — `injectDeps(deps)` middleware sets services on `c.var` so route
  modules need no constructor arguments.
- **route modules** — module-level **chained** `new Hono<{ Variables }>()`,
  `export default`ed and mounted with `app.route()`. Handlers read `c.var.*`.
- **app** — `createApp(deps): Hono` composes middleware + mounts route modules.
- **serve** — `main.ts` loads config, builds deps, calls `createApp`, `Deno.serve`.

### Dependency wiring (`main.ts`)

```
config = loadConfig(Deno.env)
db     = createDb(config)
deps   = createDeps(config, db)   // builds repos + services
app    = createApp(deps)
Deno.serve({ port: config.port }, app.fetch)
```

`createDeps` is the only place that picks the Drizzle implementations:

```
createDeps(config, db) => {
  const userRepo    = createDrizzleUserRepository(db)    // returns user + roles + perms
  const tokenRepo   = createDrizzleRefreshTokenRepository(db)
  const socialRepo  = createDrizzleSocialAccountRepository(db)
  const rateStore   = config.redisUrl
    ? createRedisRateLimitStore(config.redisUrl)
    : createMemoryRateLimitStore()
  return {
    config,
    rateStore,
    userService: createUserService({ repo: userRepo, config }),
    authService: createAuthService({ userRepo, tokenRepo, socialRepo, config }),
  }
}
```

### App assembly (`app.ts`)

`createApp(deps)` composes global middleware (`requestId`, `pinoLogger`,
`injectDeps(deps)`, `cors`, `secureHeaders`, `timeout`, a global
`rateLimiter(deps.rateStore)`), then mounts the module-level route apps (auth
routes add a stricter per-endpoint limiter):

```
const app = new Hono()
  .use(...globalMiddleware)
  .route('/users', usersRoutes)
  .route('/oauth', authRoutes)
```

`injectDeps` runs before the mounted routes so `c.var.userService` /
`c.var.authService` are populated. `app.onError` and the OpenAPI + Scalar routes
are registered here too. The app is returned **without an annotated type** so:

```
export type AppType = ReturnType<typeof createApp>
```

carries full route types for the RPC client.

## Modules

### Users (`src/modules/users/`)

- `users.schema.ts` — Zod request/response DTOs (single source of truth for
  validation and OpenAPI).
- `users.repository.ts` — `UserRepository` interface + two factories:
  - `createDrizzleUserRepository(db)` — production (MySQL).
  - `createInMemoryUserRepository()` — tests.
- `users.service.ts` — `createUserService({ repo, config })`: register, fetch,
  update, delete; hashes passwords; throws typed `AppError`.
- `users.routes.ts` — module-level **chained** `new Hono<{ Variables }>()`,
  `export default`ed. Handlers call `c.var.userService`; protected routes compose
  `requireAuth` inline.

### Auth (`src/modules/auth/`)

OAuth2 with access + refresh tokens.

- **Access token:** short-lived JWT (~15 min), verified by `requireAuth`.
- **Refresh token:** opaque random string (not a JWT). Only its SHA-256 **hash**
  is stored in `refresh_tokens`. **Rotated on every use** (old revoked, new
  issued), enabling server-side revocation/logout.
- Files:
  - `auth.schema.ts` — discriminated Zod schema on `grant_type`
    (`password` | `refresh_token`) + token response DTO.
  - `token.repository.ts` — `RefreshTokenRepository` interface +
    `createDrizzleRefreshTokenRepository(db)` and
    `createInMemoryRefreshTokenRepository()`.
  - `social.repository.ts` — `SocialAccountRepository` interface +
    `createDrizzleSocialAccountRepository(db)` / `createInMemorySocialAccountRepository()`.
  - `auth.service.ts` — `createAuthService({ userRepo, tokenRepo, socialRepo, config })`;
    also exposes `loginWithGoogle(profile)` (find-or-create user, link social
    account, issue token pair).
  - `auth.routes.ts` — module-level **chained** `new Hono<{ Variables }>()`,
    `export default`ed, for the token + revoke + Google login endpoints (reads
    `c.var.authService`).

**Google social login** uses `@hono/oauth-providers`' Google middleware
(authorization-code flow). `GET /oauth/google` redirects to Google; the middleware
handles `GET /oauth/google/callback`, exposing the verified Google profile. The
handler calls `authService.loginWithGoogle(profile)` to find-or-create the user by
email, link the identity in `social_accounts` (unique on `provider` +
`provider_account_id`), and return **your own** `{ access_token, refresh_token }`
pair (JSON; an optional redirect-with-tokens variant is noted in the README).
Social-only users have a null `password_hash`. Requires `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, and `GOOGLE_REDIRECT_URI` in config.

### Authorization / RBAC (`src/middleware/authorize.ts`)

- Roles and permissions are seeded data (see schema). `requireAuth` loads the
  user together with their roles and the **union of permission keys**, set on
  `c.var.user`.
- `requirePermission('users:list')` — middleware asserting the permission is
  present; otherwise 403.
- `requireSelfOrPermission(paramName, permission)` — passes when the authenticated
  user owns the resource (`c.req.param(paramName) === user.id`) **or** holds the
  override permission (e.g. `users:update:any`). This is the "ownership OR
  permission" rule.
- Permission keys: `users:list`, `users:read:any`, `users:update:any`,
  `users:delete:any`. Seeded `user` role gets none of the `:any` keys; seeded
  `admin` role gets all.

### Rate limiting (`src/middleware/rate-limit.ts` + `src/lib/rate-limit-store.ts`)

- `rateLimiter(store, opts)` wraps `hono-rate-limiter` with a `RateLimitStore`
  interface. Two impls: `createMemoryRateLimitStore()` (default) and
  `createRedisRateLimitStore(redisUrl)` (optional, selected by `REDIS_URL`).
- Keyed by client IP, and by user id when authenticated. A lenient global limiter
  is applied in `createApp`; a stricter limiter guards `/oauth/token` and
  `/oauth/google` to throttle credential/login attempts. Window + max come from
  config (`RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`).

## Endpoints

| Method | Path                    | Auth | Authorization | Purpose |
|--------|-------------------------|------|---------------|---------|
| POST   | `/users`                | —    | —             | Register a new user |
| POST   | `/oauth/token`          | —    | —             | `grant_type=password` → login; `grant_type=refresh_token` → rotate. Returns `{ access_token, refresh_token, token_type, expires_in }` in JSON body |
| POST   | `/oauth/revoke`         | —    | —             | Revoke a refresh token (logout) |
| GET    | `/oauth/google`         | —    | —             | Begin Google authorization-code flow |
| GET    | `/oauth/google/callback`| —    | —             | Google callback → link account, issue token pair |
| GET    | `/users/me`             | yes  | —             | Current user (with roles/permissions) |
| GET    | `/users`                | yes  | `users:list`  | List users (admin) |
| GET    | `/users/:id`            | yes  | self or `users:read:any`   | Fetch user |
| PATCH  | `/users/:id`            | yes  | self or `users:update:any` | Update user |
| DELETE | `/users/:id`            | yes  | self or `users:delete:any` | Delete user |
| GET    | `/health`               | —    | —             | Liveness |
| GET    | `/openapi`              | —    | —             | OpenAPI JSON spec |
| GET    | `/docs`                 | —    | —             | Scalar API reference UI |

## Auth & Errors

- `src/middleware/auth.ts` — `requireAuth` middleware: verifies the access JWT and
  resolves the user via `c.var.authService` (supplied by `injectDeps`), then sets
  typed `c.var.user`. Composed inline only onto protected routes.
- `src/middleware/deps.ts` — `injectDeps(deps)` middleware factory that sets
  services + `rateStore` on `c.var`.
- `src/middleware/authorize.ts` — `requirePermission` / `requireSelfOrPermission`
  (see Authorization / RBAC).
- `src/middleware/rate-limit.ts` — `rateLimiter(store, opts)` (see Rate limiting).
- `src/lib/jwt.ts` — access-token sign/verify (wraps `hono/jwt`).
- `src/lib/tokens.ts` — opaque refresh-token generate + SHA-256 hash.
- `src/lib/password.ts` — bcrypt hash/verify (`npm:bcryptjs`).
- `src/lib/errors.ts` — one flat `AppError` (status + code) with helper
  constructors (`notFound()`, `unauthorized()`, `conflict()`, `badRequest()`).
  `app.onError` maps `AppError` / `HTTPException` to a consistent JSON shape;
  unknown errors become 500 without leaking internals.

## Logging

- `src/lib/logger.ts` — `createLogger(config)` returns a configured pino instance
  (JSON in production; `pino-pretty` in development, level from env).
- `hono-pino`'s `pinoLogger` middleware is mounted globally in `createApp`, after
  `requestId`, so each request gets a child logger bound with the request id.
  Handlers and services log via `c.var.logger` (typed in `types.ts`); the pino
  instance can also be injected into services through `deps` for non-request logs.

## Database Schema (`src/db/schema.ts`, `drizzle-orm/mysql-core`)

**users**
- `id` varchar(36) PK — app-generated `crypto.randomUUID()`
- `email` varchar(255) unique not null
- `password_hash` varchar(255) **nullable** (null for social-only accounts)
- `created_at` datetime, `updated_at` datetime

**refresh_tokens**
- `id` varchar(36) PK
- `user_id` varchar(36) not null (FK → users.id)
- `token_hash` varchar(64) not null (SHA-256 hex)
- `expires_at` datetime not null
- `revoked_at` datetime nullable
- `replaced_by` varchar(36) nullable (rotation chain)
- `created_at` datetime

**social_accounts**
- `id` varchar(36) PK
- `user_id` varchar(36) not null (FK → users.id)
- `provider` varchar(32) not null (e.g. `google`)
- `provider_account_id` varchar(255) not null
- `created_at` datetime
- unique(`provider`, `provider_account_id`)

**RBAC tables**
- **roles** — `id` varchar(36) PK, `name` varchar(64) unique (`admin`, `user`)
- **permissions** — `id` varchar(36) PK, `key` varchar(64) unique (e.g. `users:list`)
- **role_permissions** — (`role_id`, `permission_id`) composite PK (M:N)
- **user_roles** — (`user_id`, `role_id`) composite PK (M:N)

A user's effective permissions are the union of permission keys across their roles.

**Seeding** (`src/db/seed.ts`, run via `deno task db:seed`): inserts the `user` and
`admin` roles, the four `users:*` permissions, and the role→permission grants
(`admin` = all, `user` = none of the `:any` keys). New registrations get the `user`
role by default.

IDs are app-generated UUIDs so the in-memory fakes and MySQL behave identically.

## Configuration (`src/config.ts`, validated with Zod)

Loaded from env (`--env-file=.env`) and documented in `.env.example`:

- `PORT`, `NODE_ENV`/`LOG_LEVEL`
- `DATABASE_URL` (MySQL)
- `JWT_SECRET`, `ACCESS_TOKEN_TTL` (default 15m), `REFRESH_TOKEN_TTL` (default 30d)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX`
- `REDIS_URL` (optional — absent ⇒ in-memory rate-limit store)

`loadConfig` fails fast with a readable error if required values are missing.

## Testing

- `Deno.test` + Hono `app.request()` for in-process integration tests.
- Build the app with **in-memory repository fakes** — no DB required for unit and
  route tests. This is the payoff of the repository interface + `injectDeps`:
  tests assemble a `Deps` object backed by in-memory repos and pass it to
  `createApp(deps)`, so the same route modules run unchanged against fakes.
- `tests/helpers.ts` — builds a test app with in-memory deps and helpers to mint
  auth headers.
- `tests/users.test.ts`, `tests/auth.test.ts` — register, login (password grant),
  refresh rotation, revoke, protected-route access.
- `tests/rbac.test.ts` — permission-gated routes, self-or-permission ownership
  (user edits self = allowed; user edits other = 403; admin = allowed).
- `tests/rate-limit.test.ts` — limiter blocks after N requests using the in-memory
  store (deterministic, no Redis).
- `tests/social-login.test.ts` — `authService.loginWithGoogle` find-or-create +
  account linking + token issuance, exercised with a stubbed Google profile (no
  real OAuth round-trip).

## Pre-commit Hooks (husky v9)

- `package.json` with `"prepare": "husky"` and husky as a devDependency; one-time
  `npm install`. (Trade-off: pulls a minimal Node footprint into a Deno project,
  used only for git-hook management. Node itself is provisioned by asdf, so no
  separate install step.)
- `.husky/pre-commit` runs, in order — any failure blocks the commit:
  1. `gitleaks protect --staged --redact` (secret scan on staged changes)
  2. `deno fmt --check`
  3. `deno lint`
  4. `deno check`
- `.gitleaks.toml` for config/allowlist. gitleaks is managed by asdf (pinned in
  `.tool-versions`), so `asdf install` provisions it alongside deno and node.
- `deno task check:all` mirrors the same checks for CI use.

## Project Structure

```
api/
├── .tool-versions         # asdf: deno 2.7.13, nodejs <LTS>, gitleaks <ver>
├── deno.json              # tasks: dev, start, test, db:generate/migrate/seed, fmt, lint, check, check:all
├── deno.lock
├── package.json           # husky only
├── docker-compose.yml     # mysql:8 + redis (optional profile)
├── .env.example
├── .gitleaks.toml
├── drizzle.config.ts
├── README.md
├── .husky/pre-commit
├── src/
│   ├── main.ts            # entrypoint: config → deps → createApp → Deno.serve
│   ├── app.ts             # createApp(deps); exports AppType
│   ├── config.ts          # zod-validated env loader
│   ├── client.ts          # hc<AppType> RPC client export
│   ├── deps.ts            # Deps type + createDeps(config, db)
│   ├── types.ts           # Hono Variables (user+perms, logger, services, rateStore)
│   ├── db/
│   │   ├── client.ts      # createDb(config)
│   │   ├── schema.ts      # users, refresh_tokens, social_accounts, RBAC tables
│   │   ├── seed.ts        # seed roles + permissions + grants
│   │   └── migrations/    # drizzle-kit output
│   ├── lib/
│   │   ├── errors.ts
│   │   ├── logger.ts      # createLogger(config) -> pino
│   │   ├── password.ts
│   │   ├── jwt.ts
│   │   ├── tokens.ts
│   │   └── rate-limit-store.ts  # RateLimitStore iface + memory/redis impls
│   ├── middleware/
│   │   ├── auth.ts        # requireAuth
│   │   ├── authorize.ts   # requirePermission / requireSelfOrPermission
│   │   ├── rate-limit.ts  # rateLimiter(store, opts)
│   │   └── deps.ts        # injectDeps(deps)
│   └── modules/
│       ├── users/
│       │   ├── users.schema.ts
│       │   ├── users.repository.ts
│       │   ├── users.service.ts
│       │   └── users.routes.ts
│       └── auth/
│           ├── auth.schema.ts
│           ├── token.repository.ts
│           ├── social.repository.ts
│           ├── auth.service.ts
│           └── auth.routes.ts
└── tests/
    ├── helpers.ts
    ├── users.test.ts
    ├── auth.test.ts
    ├── rbac.test.ts
    ├── rate-limit.test.ts
    └── social-login.test.ts
```

## Out of Scope (YAGNI)

- Second business domain / resource relationships.
- Social providers beyond Google (the provider middleware makes adding GitHub/etc.
  a small, well-isolated change).
- Admin UI / endpoints for managing roles & permissions at runtime (seeded only).
- Cookie-based token delivery (JSON body only).
- Email verification and password reset.
- CI pipeline config (the `check:all` task is CI-ready; wiring a workflow is later).
