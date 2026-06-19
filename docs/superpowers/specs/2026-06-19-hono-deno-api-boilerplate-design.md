# Design: TypeScript + Hono + Deno REST API Boilerplate

**Date:** 2026-06-19
**Status:** Approved (pending spec review)

## Goal

A production-shaped REST API boilerplate built on Deno + Hono + TypeScript that
demonstrates clean, testable structure using **composition over inheritance**. It
ships a Users domain with OAuth2 authentication (access + refresh tokens), MySQL
persistence via Drizzle, generated OpenAPI docs, an end-to-end type-safe RPC
client, and pre-commit security checks.

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
- **YAGNI.** Single Users domain; everything else is structure, not features.

## Stack

| Concern        | Choice |
|----------------|--------|
| Runtime        | Deno 2.7.13 (`deno.json` import map, tasks, fmt/lint, `--env-file`) |
| Framework      | Hono |
| Validation     | Zod + `@hono/zod-validator` |
| Database       | Drizzle ORM + **MySQL 8** (`drizzle-orm/mysql2`, `mysql2` driver) |
| Migrations     | `drizzle-kit` (`dialect: "mysql"`) |
| Auth           | OAuth2 access (JWT) + refresh tokens (opaque, stored & rotated) |
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
  const userRepo  = createDrizzleUserRepository(db)
  const tokenRepo = createDrizzleRefreshTokenRepository(db)
  return {
    config,
    userService: createUserService({ repo: userRepo, config }),
    authService: createAuthService({ userRepo, tokenRepo, config }),
  }
}
```

### App assembly (`app.ts`)

`createApp(deps)` composes global middleware (`requestId`, `pinoLogger`,
`injectDeps(deps)`, `cors`, `secureHeaders`, `timeout`), then mounts the
module-level route apps:

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
  - `auth.service.ts` — `createAuthService({ userRepo, tokenRepo, config })`.
  - `auth.routes.ts` — module-level **chained** `new Hono<{ Variables }>()`,
    `export default`ed, for the token + revoke endpoints (reads `c.var.authService`).

## Endpoints

| Method | Path            | Auth | Purpose |
|--------|-----------------|------|---------|
| POST   | `/users`        | —    | Register a new user |
| POST   | `/oauth/token`  | —    | `grant_type=password` → login; `grant_type=refresh_token` → rotate. Returns `{ access_token, refresh_token, token_type, expires_in }` in JSON body |
| POST   | `/oauth/revoke` | —    | Revoke a refresh token (logout) |
| GET    | `/users/me`     | yes  | Current user |
| GET    | `/users/:id`    | yes  | Fetch user (self) |
| PATCH  | `/users/:id`    | yes  | Update user (self) |
| DELETE | `/users/:id`    | yes  | Delete user (self) |
| GET    | `/health`       | —    | Liveness |
| GET    | `/openapi`      | —    | OpenAPI JSON spec |
| GET    | `/docs`         | —    | Scalar API reference UI |

## Auth & Errors

- `src/middleware/auth.ts` — `requireAuth` middleware: verifies the access JWT and
  resolves the user via `c.var.authService` (supplied by `injectDeps`), then sets
  typed `c.var.user`. Composed inline only onto protected routes.
- `src/middleware/deps.ts` — `injectDeps(deps)` middleware factory that sets
  `userService` / `authService` on `c.var`.
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
- `password_hash` varchar(255) not null
- `created_at` datetime, `updated_at` datetime

**refresh_tokens**
- `id` varchar(36) PK
- `user_id` varchar(36) not null (FK → users.id)
- `token_hash` varchar(64) not null (SHA-256 hex)
- `expires_at` datetime not null
- `revoked_at` datetime nullable
- `replaced_by` varchar(36) nullable (rotation chain)
- `created_at` datetime

IDs are app-generated UUIDs so the in-memory fakes and MySQL behave identically.

## Testing

- `Deno.test` + Hono `app.request()` for in-process integration tests.
- Build the app with **in-memory repository fakes** — no DB required for unit and
  route tests. This is the payoff of the repository interface + `injectDeps`:
  tests assemble a `Deps` object backed by in-memory repos and pass it to
  `createApp(deps)`, so the same route modules run unchanged against fakes.
- `tests/helpers.ts` — builds a test app with in-memory deps and helpers to mint
  auth headers.
- `tests/users.test.ts`, `tests/auth.test.ts` — register, login (password grant),
  refresh rotation, revoke, protected-route access, self-only authorization.

## Pre-commit Hooks (husky v9)

- `package.json` with `"prepare": "husky"` and husky as a devDependency; one-time
  `npm install`. (Trade-off: pulls a minimal Node footprint into a Deno project,
  used only for git-hook management.)
- `.husky/pre-commit` runs, in order — any failure blocks the commit:
  1. `gitleaks protect --staged --redact` (secret scan on staged changes)
  2. `deno fmt --check`
  3. `deno lint`
  4. `deno check`
- `.gitleaks.toml` for config/allowlist. gitleaks installed out-of-band
  (`brew install gitleaks`), documented in the README.
- `deno task check:all` mirrors the same checks for CI use.

## Project Structure

```
api/
├── deno.json              # tasks: dev, start, test, db:*, fmt, lint, check, check:all
├── deno.lock
├── package.json           # husky only
├── docker-compose.yml     # mysql:8
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
│   ├── types.ts           # Hono Variables (user, logger, userService, authService)
│   ├── db/
│   │   ├── client.ts      # createDb(config)
│   │   ├── schema.ts      # users + refresh_tokens (mysql-core)
│   │   └── migrations/    # drizzle-kit output
│   ├── lib/
│   │   ├── errors.ts
│   │   ├── logger.ts      # createLogger(config) -> pino
│   │   ├── password.ts
│   │   ├── jwt.ts
│   │   └── tokens.ts
│   ├── middleware/
│   │   ├── auth.ts        # requireAuth
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
│           ├── auth.service.ts
│           └── auth.routes.ts
└── tests/
    ├── helpers.ts
    ├── users.test.ts
    └── auth.test.ts
```

## Out of Scope (YAGNI)

- Second business domain / resource relationships.
- Role-based access control beyond self-ownership checks.
- Cookie-based token delivery (JSON body only).
- Email verification, password reset, social login providers.
- Rate limiting and CI pipeline config (can be added later).
