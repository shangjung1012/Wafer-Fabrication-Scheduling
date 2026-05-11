# 工廠訂單管理排程系統

A Next.js + Prisma (PostgreSQL) wafer factory order scheduling system.

## Folder Structure

```text
wafer-fabrication-scheduling/
├── app/                    # Presentation layer: UI + API route handlers
│   ├── api/                # API endpoints (Next.js App Router)
│   │   ├── auth/
│   │   ├── docs/spec/      # GET /api/docs/spec — serves OpenAPI YAML
│   │   ├── orders/
│   │   ├── schedule/
│   │   └── users/          # User Management API (CRUD)
│   └── docs/               # Swagger UI (http://localhost:3000/docs)
├── modules/                # Business logic layer
│   ├── auth/               # JWT auth, RBAC helpers
│   └── users/              # User service (scope-filtered CRUD)
├── infra/
│   └── db/                 # DB access layer (repositories)
├── lib/
│   └── prisma.ts           # Prisma client singleton
├── prisma/
│   ├── schema.prisma
│   ├── seed.ts             # Dev seed data
│   └── migrations/
├── api_spec.yml            # OpenAPI 3.0 spec (source of truth)
└── .cursor/                # Team docs & rules for AI-assisted development
    ├── docs/
    └── rules/
```

## Local Setup

### 1. 環境變數

```bash
cp .env.example .env
```

`.env` 需包含：

```env
DATABASE_URL="postgresql://wafer_user:wafer_password@localhost:5432/wafer_db?schema=public"
JWT_SECRET="replace-with-a-strong-secret-at-least-32-chars"
JWT_ISSUER="wafer-auth"
JWT_AUDIENCE="wafer-api"
ACCESS_TOKEN_EXPIRES_IN="15m"
REFRESH_TOKEN_EXPIRES_IN="7d"
```

### 2. 啟動資料庫

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

1. `POST /api/auth/register` 已停用公開註冊。
2. `POST /api/auth/login` 使用 `username` 或 `email` / `password` 登入，取得 auth cookies。
3. 呼叫受保護 API 時使用 `Authorization: Bearer <accessToken>`。
4. `POST /api/auth/refresh` 以 refresh token rotation 換發新 token。
5. `POST /api/auth/logout` 撤銷 refresh token。

---

## API 文件

開啟 **[http://localhost:3000/docs](http://localhost:3000/docs)**

1. 到 **[http://localhost:3000/login](http://localhost:3000/login)** 登入。
2. 複製 login response/session 內的 `accessToken`。
3. 在 docs 頁右上角 **Authorize** 輸入 `Bearer <accessToken>`。
4. 展開任一 endpoint → **Try it out** → **Execute**。

OpenAPI spec：[`api_spec.yml`](./api_spec.yml)

---

## Scripts

| 指令               | 說明                    |
| ------------------ | ----------------------- |
| `pnpm dev`         | 啟動 Next.js dev server |
| `pnpm build`       | 建置 production         |
| `pnpm db:migrate`  | 執行 Prisma migration   |
| `pnpm db:generate` | 產生 Prisma client      |
| `pnpm db:seed`     | Seed 測試資料進 DB      |
| `pnpm db:studio`   | 開啟 Prisma Studio      |
