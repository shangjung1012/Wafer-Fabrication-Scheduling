# API conventions

本文件定義 API 命名、回應格式、錯誤格式與驗證規範，並與 `api_spec.yml` 對齊。

## Source of truth

- API 規格以 `api_spec.yml` 為主（OpenAPI）
- 實作應維持「路由、method、資料結構」一致

## Routing & structure (Next.js)

- App Router route handlers：`app/api/<segment>/route.ts`
- 若為 nested resource：`app/api/orders/[id]/route.ts`（示例）

> 目前 `app/api/*` 目錄存在但尚未放 route handlers；新增 API 時請同步更新 `api_spec.yml`。

## Validation

- 每個 endpoint 必須做輸入驗證（建議 `zod`）：
  - body（JSON）
  - query params（日期、分页）
  - path params（id）

## Success response

建議 API 成功回應：
- list：`{ items: T[], nextCursor?: string }`（或 offset/limit）
- detail：`T`
- write：`{ id: string }` 或回傳更新後的 entity

## Error response (recommended)

統一錯誤格式（server-only）：

```json
{
  "code": "FORBIDDEN",
  "message": "You do not have access to this factory.",
  "details": { "factoryId": "..." }
}
```

- `400`: validation error
- `401`: unauthenticated
- `403`: forbidden
- `404`: not found
- `409`: conflict（例如排程衝突、版本衝突）
- `500`: unexpected

## Idempotency & concurrency

排程確認（spec 中「版本號推進」）建議採用：
- **optimistic concurrency**：request 帶 `version`，不一致回 `409`
- 記錄 `updatedAt` / schedule version（見 `docs/scheduling_conflicts.md`）

