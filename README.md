# 工廠訂單管理排程系統

A Next.js + Prisma (PostgreSQL) wafer factory order scheduling system，包含訂單流程、RBAC、排程視覺化與 Azure Communication Services Email 邀請機制。

## Folder Structure

```text
wafer-fabrication-scheduling/
├── app/                    # Presentation layer: UI + API route handlers
│   ├── (auth)/             # Login / set-password pages
│   ├── (dashboard)/        # Orders / visualization / users UI
│   ├── api/                # API endpoints (Next.js App Router)
│   │   ├── auth/           # Login, refresh, logout, invitations
│   │   ├── assignments/    # Manual assignment move / pending order placement API
│   │   ├── conflict-issues/ # Scheduling conflict and cancellation issue workflow
│   │   ├── docs/           # Swagger UI (http://localhost:3000/docs)
│   │   ├── orders/
│   │   ├── schedule/       # Schedule runner API
│   │   ├── system/         # Health, simulation clock, auto-scheduler config
│   │   ├── users/          # User invitation/listing API
│   │   └── visualization/  # Timeline data API
├── modules/                # Business logic layer
│   ├── auth/               # JWT auth, RBAC, invitations
│   ├── mail/               # Azure Email adapter
│   ├── order/              # Order and conflict issue services
│   ├── schedule/           # Scheduling engine
│   ├── users/              # User listing/invitation service
│   └── visualization/      # Timeline/read model service
├── infra/
│   └── db/                 # DB access layer (repositories)
├── lib/
│   └── prisma.ts           # Prisma client singleton
├── prisma/
│   ├── schema.prisma
│   ├── seed.ts             # Dev seed data
│   └── migrations/
├── api_spec.yml            # OpenAPI 3.0 spec (source of truth)
├── Dockerfile
└── docker-compose.yml
```

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

雲端 Redis 若啟用 Redis Cluster，需設定 `REDIS_CLUSTER="true"`。如需指定多個 cluster startup nodes，可用逗號分隔的 `REDIS_CLUSTER_NODES` 覆蓋 `REDIS_URL`。

### 2. 啟動資料庫與 Redis

```bash
docker compose up -d
```

### 3. 執行 Migration

```bash
pnpm db:migrate
```

### 4. 產生 Prisma client

```bash
pnpm db:generate
```

### 5. Seed 測試資料

```bash
pnpm db:seed
```

Seed 會建立以下測試資料（idempotent，可重複執行）：

```
Type A：SUPERADMIN(sa-A)、Factory A1/A2/A3、ADMIN(admin-A1/A2/A3)、SALES(sales-A)
Type B：SUPERADMIN(sa-B)、Factory B1/B2/B3、ADMIN(admin-B1/B2/B3)、SALES(sales-B)
Type C：SUPERADMIN(sa-C)、Factory C1/C2/C3、ADMIN(admin-C1/C2/C3)、SALES(sales-C)
```

Seed 帳號使用 `username` 登入，開發用預設密碼皆為 `Password123!`。

### 6. 啟動開發伺服器

```bash
pnpm dev
```

---

## 身份驗證

公開註冊已停用。使用者透過 SUPERADMIN 邀請建立：

1. `SUPERADMIN` 在 `/users` 頁面邀請使用者（填入 `email`、`role`、`group`）。
2. 系統寄送 Azure Email，內含 180 秒有效的 `/set-password?token=...` 連結。
3. 受邀者設定 `username` 與密碼後即可登入。
4. `POST /api/auth/login` 使用 `username` 或 `email` / `password` 登入，取得 auth cookies。
5. `POST /api/auth/refresh` 以 refresh token rotation 換發新 token。
6. `POST /api/auth/logout` 撤銷 refresh token。

---

## API 文件

開啟 **[http://localhost:3000/docs](http://localhost:3000/docs)**

1. 到 **[http://localhost:3000/login](http://localhost:3000/login)** 登入。
2. 複製 login response 內的 `accessToken` cookie。
3. 在 docs 頁右上角 **Authorize** 輸入 `Bearer <accessToken>`。
4. 展開任一 endpoint → **Try it out** → **Execute**。

OpenAPI spec：[`api_spec.yml`](./api_spec.yml)

---

## Scripts

| 指令               | 說明                               |
| ------------------ | ---------------------------------- |
| `pnpm dev`         | 啟動 Next.js dev server            |
| `pnpm build`       | 建置 production                    |
| `pnpm lint`        | 執行 ESLint                        |
| `pnpm test`        | 執行 Vitest                        |
| `pnpm format`      | 格式化程式碼（Prettier）           |
| `pnpm db:migrate`  | 執行 Prisma migration（local dev） |
| `pnpm db:deploy`   | 套用 migration（CI/production）    |
| `pnpm db:generate` | 產生 Prisma client                 |
| `pnpm db:seed`     | Seed 測試資料進 DB                 |
| `pnpm db:studio`   | 開啟 Prisma Studio                 |
