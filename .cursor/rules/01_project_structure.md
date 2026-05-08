# Rule: project structure & file placement

你在這個 repo 產生/修改程式碼時，必須遵守以下規則。

## Current structure (source of truth)

本 repo 目前以根目錄分層：
- `app/`：UI + route handlers（API）
- `modules/`：商業邏輯
- `infra/`：DB/外部整合
- `prisma/`：schema/migrations
- `lib/`：共用工具與 generated code

## Where code must go

- **API**：只能放在 `app/api/**`（Next.js route handlers）
- **Business logic**：只能放在 `modules/**`
- **DB access**（Prisma client / repositories）：只能放在 `infra/db/**`
- **UI pages/layout/components**：`app/**`（避免把 domain logic 放進 React components）

## Allowed dependencies

- `app/*` 可以 import `modules/*`
- `modules/*` 可以 import `infra/*`
- `infra/*` 不可以 import `app/*`

## Don’ts

- 禁止在 `app/*` 直接寫 Prisma query（必須透過 `modules` 或 `infra`）
- 禁止把 RBAC 判斷只放在前端（server 必須驗證）

