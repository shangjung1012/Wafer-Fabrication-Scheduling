# Skill: add Prisma model or field

## Purpose

安全地新增/修改 Prisma model 或欄位（含 migration、backfill、API 契約與權限影響評估）。

## Inputs

- 需求描述（為什麼需要這個欄位/模型）
- 目標 model/欄位（名稱、型別、nullable/optional）
- relation（若有）
- index/unique（若有）
- 影響的 endpoints（對應 `api_spec.yml`）

## Steps

1. 先檢查 `prisma/schema.prisma` 是否已有相近欄位/模型（避免重複）。
2. 設計 schema 變更：
   - 是否需要 enum
   - 是否需要 index（排程/視覺化多為時間區間查詢）
3. 評估資料遷移：
   - 新欄位是否可 nullable 以保持向後相容
   - 是否需要 backfill script（大量資料時）
4. 跑 migration：
   - local：`pnpm db:migrate`
   - deploy：`pnpm db:deploy`
5. 更新 generated client：`pnpm db:generate`
6. 更新受影響的 service/API 與 `api_spec.yml`（schema/response）
7. 檢查 RBAC/scope 是否需要調整（`docs/domain_rbac.md`）。

## Output artifacts

- `prisma/schema.prisma`
- `prisma/migrations/*`
- 受影響的 modules/infra 讀寫
- 受影響的 `api_spec.yml` schemas
-（必要時）backfill/seed scripts（依專案習慣）

## Gotchas

- migration 是 forward-only：回滾策略要靠 feature flag/向後相容（見 `docs/devops_runbook.md`）
- 任何授權資料（scope）要能在 DB trace（不要只放在 token）

