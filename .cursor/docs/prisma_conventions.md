# Prisma conventions

本文件補齊 Prisma 使用習慣，讓資料一致性、效能與遷移流程可控。

## Source of truth

- Schema：`prisma/schema.prisma`
- Migration：`prisma/migrations/*`
- Generated client：目前 generator output 指到 `lib/generated/prisma`

## DB access layering

推薦：
- `infra/db/*` 放 Prisma client 初始化與 repository helpers
- `modules/*` 不直接 new PrismaClient；只透過 `infra` 取得 client 或 repository

> 目前 `infra/db/` 只有 `.keep`，後續若建立 client，建議固定為 `infra/db/client.ts`。

## Migration workflow (scripts in package.json)

- generate client：`pnpm db:generate`
- local dev migrate：`pnpm db:migrate`
- deploy migrate：`pnpm db:deploy`
- studio：`pnpm db:studio`

## Data modeling guidelines

- enum 以 Prisma enum 為準：`UserRole`, `OrderStatus`, `FactoryStatus`
- 一律使用 `cuid()` 或 `uuid()` 產生 id（目前使用 `cuid()`）
- 任何授權相關資料必須在 DB 有 trace（例如 `OrderPermission`、`Factory.adminId`）

## Transactions

以下情境必用 transaction：
- 排程確認（寫入多筆 order / factory capacity）
- 訂單分配到 factory（會同時改 order 與 capacity）
- 權限批次變更（user role + managed scope）

## Performance

- list 查詢避免 N+1：用 `include/select` 或分段查（依需求）
- pagination 一律明確（cursor 或 offset/limit）
- 排程/視覺化查詢通常是「時間區間 + factoryId」：建議建立對應 index（實際需依 schema 擴充）

