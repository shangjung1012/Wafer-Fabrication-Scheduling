# 工廠訂單管理排程系統

Next.js + Prisma + PostgreSQL 的 wafer factory order scheduling system，包含訂單流程、RBAC、排程視覺化、SUPERADMIN 邀請註冊，以及 Azure Communication Services Email 發信。

## Architecture

```text
wafer-fabrication-scheduling/
├── app/                         # Next.js App Router
│   ├── (auth)/                  # Login / set-password pages
│   ├── (dashboard)/             # Orders / visualization / users UI
│   ├── api/                     # Route handlers
│   │   ├── auth/                # Login, refresh, logout, invitations
│   │   ├── orders/              # Orders API
│   │   ├── requests/            # Order change request API
│   │   ├── schedule/            # Schedule runner API
│   │   └── users/               # User invitation/listing API
│   └── docs/                    # Swagger UI
├── modules/                     # Business logic
│   ├── auth/                    # JWT, cookies, RBAC, invitation, username
│   ├── mail/                    # Azure Email adapter
│   ├── order/                   # Order/request services
│   ├── schedule/                # Scheduling engine
│   ├── users/                   # User listing/invitation service boundary
│   └── visualization/           # Timeline/read model service
├── infra/db/                    # Prisma repository layer
├── prisma/
│   ├── schema.prisma
│   ├── seed.ts                  # Idempotent dev/test seed data
│   └── migrations/              # Deployable DB migrations
├── scripts/
│   ├── benchmark.ts
│   └── update-containerapp-env.ts
├── .github/workflows/
│   ├── ci.yml
│   └── deploy-container-app.yml
├── api_spec.yml                 # OpenAPI spec
├── Dockerfile
└── docker-compose.yml
```

The intended dependency direction is:

```text
app route/page
  -> modules/*
    -> infra/db/*
      -> Prisma
```

Route handlers should stay thin. Authorization, scope checks, and workflow logic belong in `modules/*`; raw database access belongs in `infra/db/*`.

## Local Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Create environment file

```bash
cp .env.example .env
```

Required local values include:

```env
DATABASE_URL="postgresql://wafer_user:wafer_password@localhost:5432/wafer_db?schema=public"
REDIS_URL="redis://localhost:6379"
APP_BASE_URL="http://localhost:3000"
JWT_SECRET="replace-with-a-strong-secret-at-least-32-chars"
JWT_ISSUER="wafer-auth"
JWT_AUDIENCE="wafer-api"
ACCESS_TOKEN_EXPIRES_IN="15m"
REFRESH_TOKEN_EXPIRES_IN="7d"
```

Mail sending uses Azure Communication Services Email:

```env
AZURE_COMMUNICATION_EMAIL_CONNECTION_STRING="endpoint=...;accesskey=..."
AZURE_COMMUNICATION_EMAIL_SENDER_ADDRESS="DoNotReply@example.com"
```

Tests mock mail delivery, so GitHub CI does not need Azure mail secrets.

### 3. Start local services

```bash
docker compose up -d
```

### 4. Apply schema and seed data

```bash
pnpm db:migrate
pnpm db:generate
pnpm db:seed
```

Use `pnpm db:deploy` instead of `pnpm db:migrate` in deployed environments.

### 5. Start the app

```bash
pnpm dev
```

Open:

- App login: <http://localhost:3000/login>
- Orders UI: <http://localhost:3000/orders>
- Visualization UI: <http://localhost:3000/visualization>
- User invitations UI: <http://localhost:3000/users>
- API docs: <http://localhost:3000/docs>

## Seed Accounts

Seed data is idempotent and creates three production groups: `A`, `B`, and `C`.

```text
Type A: SUPERADMIN(sa-A), ADMIN(admin-A1/admin-A2/admin-A3), SALES(sales-A)
Type B: SUPERADMIN(sa-B), ADMIN(admin-B1/admin-B2/admin-B3), SALES(sales-B)
Type C: SUPERADMIN(sa-C), ADMIN(admin-C1/admin-C2/admin-C3), SALES(sales-C)
```

Default password:

```text
Password123!
```

Login supports either username or email. Username preserves case, so `admin-A1` and `admin-a1` are different values.

## Auth And Users

Public registration is disabled:

```text
POST /api/auth/register -> 403 SELF_REGISTRATION_DISABLED
```

User creation is invitation based:

1. `SUPERADMIN` opens `/users`.
2. `SUPERADMIN` invites a user with `email`, `role`, and `group`.
3. The backend creates a pending user with `username = null` and `password = null`.
4. The backend sends an Azure Email invite with a 180-second `/set-password?token=...` link.
5. The invited user sets `username` and password.
6. Login accepts username or email with password.

Security notes:

- Access and refresh tokens are stored in HttpOnly cookies.
- Cookie-auth unsafe methods require same-origin checks against `APP_BASE_URL`.
- Invitation tokens are stored as SHA-256 hashes.
- Pending users cannot log in until password and username are set.
- Username is trimmed, must be 3-32 characters, and may contain letters, numbers, `.`, `_`, and `-`; it must start and end with a letter or number.

## Database Workflow

Local development:

```bash
pnpm db:migrate      # prisma migrate dev
pnpm db:generate     # prisma generate
pnpm db:seed         # prisma db seed
```

Production/deploy:

```bash
pnpm db:deploy       # prisma migrate deploy
```

Use `pnpm prisma migrate reset` only for local development. It drops and recreates the database, then reapplies migrations. Never run it against production.

For column renames, review migration SQL manually. Prisma may generate drop/add operations instead of a data-preserving rename.

## Azure Deployment

Container deployment is handled by:

```text
.github/workflows/deploy-container-app.yml
```

It builds the Docker image, pushes to Azure Container Registry, and updates Azure Container App.

Environment variables can be pushed manually from `.env.publish`:

```bash
pnpm azure:env:update -- --dry-run
pnpm azure:env:update -- --file .env.publish --resource-group rg-wafer-dev --app waferdev-web
```

The script masks values in logs, but `.env.publish` still contains secrets and must not be committed if it includes real credentials.

## CI

Current CI runs on pull requests to `main` and pushes to `dev`:

```text
.github/workflows/ci.yml
```

It performs:

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm db:deploy
pnpm db:seed
pnpm lint
pnpm test
pnpm build
docker build
```

## Scripts

| Command                 | Description                              |
| ----------------------- | ---------------------------------------- |
| `pnpm dev`              | Start Next.js dev server                 |
| `pnpm build`            | Build production app                     |
| `pnpm start`            | Start production server                  |
| `pnpm lint`             | Run ESLint                               |
| `pnpm test`             | Run Vitest                               |
| `pnpm format`           | Format files with Prettier               |
| `pnpm format:check`     | Check formatting                         |
| `pnpm db:migrate`       | Run `prisma migrate dev` for local dev   |
| `pnpm db:deploy`        | Run deploy-safe Prisma migrations        |
| `pnpm db:generate`      | Generate Prisma client                   |
| `pnpm db:seed`          | Seed local/test data                     |
| `pnpm db:studio`        | Open Prisma Studio                       |
| `pnpm benchmark`        | Run scheduling benchmark                 |
| `pnpm azure:env:update` | Update Azure Container App env variables |

## Verification

Before opening a PR or deploying:

```bash
pnpm db:generate
pnpm lint
pnpm test
pnpm build
```

If RBAC tests fail with missing group or factory assignment errors, reseed the local database:

```bash
pnpm db:seed
pnpm test
```
