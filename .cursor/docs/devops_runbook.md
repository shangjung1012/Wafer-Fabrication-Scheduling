# DevOps runbook

本文件聚焦「可操作」：本地開發、CI、部署、遷移與回滾。

## Local development

### 1) Env

- 參考 `.env.example` 複製成 `.env`
- 確認 DB connection string 與 Prisma datasource 對應

### 2) Start dependencies

`docker-compose.yml` 定義本地依賴（PostgreSQL 等）。

```bash
docker compose up -d
```

### 3) Migrate & generate

```bash
pnpm db:migrate
pnpm db:generate
```

### 4) Run app

```bash
pnpm dev
```

## CI (recommended baseline)

最小 CI 建議順序：

1. install（pnpm lockfile）
2. lint：`pnpm lint`
3. typecheck：`pnpm -s tsc --noEmit`（若你有 typecheck script 可改）
4. test：vitest（若已建立）
5. build：`pnpm build`
6. prisma validate / migrate check（視部署型態）

## Deployment & migrations

### Migration order

- 先部署「向後相容」的 code（能同時讀新舊欄位）
- 再跑 `pnpm db:deploy`
- 最後再開啟依賴新欄位/新約束的 feature

### Rollback

- schema rollback 困難（migration 一旦 deploy），策略應以：
  - feature flag
  - 向後相容讀寫
  - 補償 migration（forward-only）

## Secrets

- JWT secret / signing keys 僅存在 server-side env
- 不要把任何 secret commit 進 repo（包含 `.env`）

