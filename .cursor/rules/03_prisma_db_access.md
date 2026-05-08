# Rule: Prisma / DB access

## Prisma schema & enums

- Prisma schema：`prisma/schema.prisma`
- 所有 role/status 都必須使用 enum：
  - `UserRole`
  - `OrderStatus`
  - `FactoryStatus`

## Where Prisma client must live

- Prisma client 初始化應集中在 `infra/db/client.ts`
- `app/*` 不得直接 import Prisma client
- `modules/*` 不得 new PrismaClient（只能注入或 import `infra/db/client`)

> 目前 `infra/db/` 只有 `.keep`；若要新增 client，請以 `infra/db/client.ts` 為固定位置。

## Transactions (must)

以下操作必須使用 transaction：
- 排程確認生效（多筆 order + capacity）
- 分配訂單到工廠（order + capacity）
- 權限批次更新（role + scope）

## Query rules

- list endpoints 必須做 pagination（cursor 或 offset/limit）
- 避免 N+1：必要時使用 `include/select` 或 batch query
- 時間區間查詢（排程/視覺化）請優先設計 index（後續依 schema 擴充）

