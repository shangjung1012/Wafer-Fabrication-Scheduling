[![Quality Gate Status](https://sonarcloud.io/api/project_badges/quality_gate?project=shangjung1012_Wafer-Fabrication-Scheduling)](https://sonarcloud.io/summary/new_code?id=shangjung1012_Wafer-Fabrication-Scheduling)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=shangjung1012_Wafer-Fabrication-Scheduling&metric=coverage)](https://sonarcloud.io/summary/new_code?id=shangjung1012_Wafer-Fabrication-Scheduling)
[![Bugs](https://sonarcloud.io/api/project_badges/measure?project=shangjung1012_Wafer-Fabrication-Scheduling&metric=bugs)](https://sonarcloud.io/summary/new_code?id=shangjung1012_Wafer-Fabrication-Scheduling)
[![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=shangjung1012_Wafer-Fabrication-Scheduling&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=shangjung1012_Wafer-Fabrication-Scheduling)

# 工廠訂單管理排程系統

A **Next.js 15 + Prisma (PostgreSQL) + Redis** wafer factory order scheduling system. Features include multi-role order workflow (SALES → ADMIN → SUPERADMIN), a drag-and-drop scheduling visualisation, auto-scheduling engine, conflict-issue management, and Azure Communication Services email notifications.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Browser (Next.js App Router — React Server + Client)   │
│  app/(auth)/   app/(dashboard)/   app/api/              │
└────────────────────────┬────────────────────────────────┘
                         │ HTTP / fetch
┌────────────────────────▼────────────────────────────────┐
│  Business Logic  (modules/)                             │
│  auth · order · schedule · visualization · mail · users │
└──────────┬──────────────────────────────────────────────┘
           │
┌──────────▼──────────┐   ┌──────────────┐
│  infra/db (Prisma)  │   │  infra/redis │
│  PostgreSQL         │   │  Redis       │
└─────────────────────┘   └──────────────┘
```

## Folder Structure

```text
wafer-fabrication-scheduling/
├── app/                        # Presentation layer: UI + API route handlers
│   ├── (auth)/                 # Login / set-password / accept-invitation pages
│   ├── (dashboard)/            # Orders, visualization, users, profile UI
│   └── api/                    # API endpoints (Next.js App Router)
│       ├── auth/               # Login, refresh, logout, register (disabled)
│       ├── assignments/        # Manual assignment move / bulk operations
│       ├── conflict-issues/    # Conflict & cancellation issue workflow
│       ├── docs/               # Swagger UI — http://localhost:3000/docs
│       ├── orders/             # Order CRUD + CSV import
│       ├── schedule/           # Schedule preview & apply
│       ├── system/             # Health, simulation clock, auto-scheduler config
│       ├── users/              # Invitation / user management
│       └── visualization/      # Timeline data API
├── modules/                    # Business logic layer
│   ├── auth/                   # JWT tokens, RBAC, sessions, invitations
│   ├── mail/                   # Azure Email + SMTP fallback adapter
│   ├── order/                  # Order service, conflict-issue service
│   ├── schedule/               # Auto-scheduler, core engine, simulation
│   ├── users/                  # User listing service
│   └── visualization/          # Timeline / read-model service
├── infra/
│   ├── db/                     # Prisma repository layer
│   └── redis/                  # Schedule store, preview cache, distributed lock
├── components/                 # Shared React components
├── lib/                        # Prisma client singleton, date utils, Redis client
├── __tests__/                  # Vitest unit & integration tests (>80 % coverage)
├── prisma/
│   ├── schema.prisma
│   ├── seed.ts                 # Idempotent dev seed
│   └── migrations/
├── api_spec.yml                # OpenAPI 3.0 spec (source of truth)
├── Dockerfile
└── docker-compose.yml
```

---

## Local Setup

### 1. 環境變數

```bash
cp .env.example .env
```

`.env` 需包含：

```env
DATABASE_URL="postgresql://wafer_user:wafer_password@localhost:5432/wafer_db?schema=public"
REDIS_URL="redis://localhost:6379"
REDIS_CLUSTER="false"
APP_BASE_URL="http://localhost:3000"
JWT_SECRET="replace-with-a-strong-secret-at-least-32-chars"
JWT_ISSUER="wafer-auth"
JWT_AUDIENCE="wafer-api"
ACCESS_TOKEN_EXPIRES_IN="15m"
REFRESH_TOKEN_EXPIRES_IN="7d"
AZURE_COMMUNICATION_EMAIL_CONNECTION_STRING="endpoint=...;accesskey=..."
AZURE_COMMUNICATION_EMAIL_SENDER_ADDRESS="DoNotReply@example.com"
```

> **SMTP fallback** — set `SMTP_FALLBACK_ENABLED=true` and configure `SMTP_FALLBACK_HOST / PORT / USER / PASSWORD` to use SMTP instead of Azure Email.

> **Redis Cluster** — set `REDIS_CLUSTER=true` and optionally `REDIS_CLUSTER_NODES` (comma-separated) for multi-node setups.

### 2. 啟動資料庫與 Redis

```bash
docker compose up -d
```

### 3. 執行 Migration + 產生 Prisma client + Seed

```bash
pnpm db:migrate      # apply migrations (local dev)
pnpm db:generate     # generate Prisma client
pnpm db:seed         # seed test data (idempotent)
```

Seed 會建立以下測試帳號（密碼皆為 `Password123!`）：

| Group | SUPERADMIN | Factories    | ADMIN            | SALES                 |
| ----- | ---------- | ------------ | ---------------- | --------------------- |
| A     | `sa-A`     | A1 / A2 / A3 | `admin-A1/A2/A3` | `sales-1` ~ `sales-3` |
| B     | `sa-B`     | B1 / B2 / B3 | `admin-B1/B2/B3` | `sales-4` ~ `sales-6` |
| C     | `sa-C`     | C1 / C2 / C3 | `admin-C1/C2/C3` | `sales-7` ~ `sales-9` |

### 4. 啟動開發伺服器

```bash
pnpm dev
```

---

## 身份驗證

公開註冊已停用。使用者透過 SUPERADMIN 邀請建立：

1. `SUPERADMIN` 在 `/users` 頁面邀請（填入 `email`、`role`、`group`）。
2. 系統寄送 Azure Email，內含 180 秒有效的 `/set-password?token=...` 連結。
3. 受邀者設定 `username` 與密碼後即可登入。
4. `POST /api/auth/login` 以 `username` 或 `email` + `password` 登入，取得 auth cookies。
5. `POST /api/auth/refresh` 以 refresh token rotation 換發新 token。
6. `POST /api/auth/logout` 撤銷 session。

---

## API 文件

開啟 **[http://localhost:3000/docs](http://localhost:3000/docs)**（Swagger UI）。

1. 到 `/login` 登入，取得 `accessToken`。
2. 在 docs 頁右上角 **Authorize** 輸入 `Bearer <accessToken>`。
3. 展開任一 endpoint → **Try it out** → **Execute**。

OpenAPI spec：[`api_spec.yml`](./api_spec.yml)

---

## Testing

```bash
pnpm test               # run all tests (Vitest)
pnpm test:coverage      # run with coverage report (lcov + text)
```

Test suite: **>80% line coverage**, 300+ test cases across unit, mock-based service, and integration layers.

| Layer              | What's tested                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Unit               | Pure functions: auth tokens, RBAC, scope, username validation, date utils                                                            |
| Service (mocked)   | Auth service, order service, conflict-issue service, visualization, auto-scheduler, mail service                                     |
| Components (jsdom) | React components: SalesOrdersSection, AdminPendingSection, DashboardSummary, ConflictIssueSection, OrderCsvDropZone, edit-cell chips |
| Integration        | Schedule engine, Redis lock, DB repositories (requires running DB)                                                                   |

CI runs the full suite on every PR targeting `main` (PostgreSQL 17 + Redis 7 service containers).

---

## Code Quality

| Tool                              | What it enforces                                                          |
| --------------------------------- | ------------------------------------------------------------------------- |
| **ESLint** (pre-commit via Husky) | Code style, accessibility (a11y), TypeScript rules                        |
| **Prettier**                      | Consistent formatting across all files                                    |
| **TypeScript strict mode**        | Compile errors block the build                                            |
| **Vitest + v8**                   | >80% line coverage; lcov report uploaded to SonarCloud                    |
| **SonarCloud**                    | Security, reliability, maintainability scan on every push to `main`/`dev` |

SonarCloud badges above reflect the latest `main` branch analysis.

---

## Scripts

| 指令                    | 說明                               |
| ----------------------- | ---------------------------------- |
| `pnpm dev`              | 啟動 Next.js dev server            |
| `pnpm build`            | 建置 production                    |
| `pnpm lint`             | 執行 ESLint                        |
| `pnpm test`             | 執行 Vitest                        |
| `pnpm test:coverage`    | 執行 Vitest + 產生 coverage report |
| `pnpm format`           | 格式化程式碼（Prettier）           |
| `pnpm db:migrate`       | 執行 Prisma migration（local dev） |
| `pnpm db:deploy`        | 套用 migration（CI / production）  |
| `pnpm db:generate`      | 產生 Prisma client                 |
| `pnpm db:seed`          | Seed 測試資料進 DB                 |
| `pnpm db:studio`        | 開啟 Prisma Studio                 |
| `pnpm azure:env:update` | 更新 Azure Container App 環境變數  |

---

## Deployment

The app is containerised with Docker. A GitHub Actions workflow builds and pushes the image; a separate `deploy-container-app.yml` workflow deploys to **Azure Container Apps**.

```bash
docker build -t wafer-scheduling-next .
docker compose up          # local full-stack (Next.js + PostgreSQL + Redis)
```
