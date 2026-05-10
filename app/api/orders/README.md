# /api/orders & /api/requests

訂單（Orders）與修改申請（Requests）的 10 支 API。

---

## Endpoints 總覽

### Orders

| Method | Path | 說明 | 權限 |
|---|---|---|---|
| GET | `/api/orders` | 列出訂單（可帶 `?status=` `?keyword=` filter） | ALL |
| GET | `/api/orders/:id` | 取得單筆訂單 | ALL |
| POST | `/api/orders` | 建立訂單（單筆） | SALES |
| PUT | `/api/orders/:id` | 修改訂單欄位 | SALES / ADMIN |
| DELETE | `/api/orders` | 批次軟刪除訂單（body: `{ids:[...]}`） | ADMIN |
| POST | `/api/orders/import` | 匯入 CSV 批次建立訂單 | ADMIN / SUPERADMIN |

### Requests

| Method | Path | 說明 | 權限 |
|---|---|---|---|
| GET | `/api/requests` | 列出修改申請 | ALL |
| POST | `/api/requests` | 建立修改申請 | SALES |
| PUT | `/api/requests/:id` | 修改申請內容（message / payload） | SALES |
| POST | `/api/requests/:id/approve` | 核准申請，將 payload 套用到訂單 | ADMIN / SUPERADMIN |

---

## 資料結構

### Order

```ts
{
  id: string
  name: string
  type: string          // production group: "A" | "B" | "C"
  status: OrderStatus   // PENDING | APPROVED | SCHEDULED | IN_PRODUCTION | COMPLETED | CANCELLED
  dueDate: Date
  quantity: number
  applicantId: string   // SALES user who created it
  lastModifiedById: string | null
  createdAt: Date
  updatedAt: Date
}
```

### Order Status Machine

```
PENDING → APPROVED → SCHEDULED → IN_PRODUCTION → COMPLETED
                                               ↘ CANCELLED
```

- `PENDING`：SALES 剛建立，SALES 還可以直接 `PUT /orders/:id` 修改欄位
- `APPROVED` 之後：SALES 不能直接改，只能送 `OrderRequest`；Admin 管理

### OrderRequest

```ts
{
  id: string
  orderId: string
  requesterId: string
  message: string
  payload: Record<string, unknown>  // 想改的欄位，例如 { quantity: 2000 }
  createdAt: Date
  updatedAt: Date
}
```

---

## 各角色可做的事

| 操作 | SALES | ADMIN | SUPERADMIN |
|---|---|---|---|
| 列出訂單 | ✓ 只看自己建立的 | ✓ 同 group 的訂單 | ✓ 同 group 的訂單 |
| 取得單筆訂單 | ✓ 只看自己建立的 | ✓ 同 group | ✓ 同 group |
| 建立訂單 | ✓ | — | — |
| 修改訂單 | ✓ 自己的 PENDING，不能改 status | ✓ 同 group，可改 status | — |
| 刪除訂單 | — | ✓ | — |
| 匯入 CSV | — | ✓ | ✓ |
| 建立申請 | ✓ 自己建立的訂單 | — | — |
| 修改申請 | ✓ 自己的申請 | — | — |
| 核准申請 | — | ✓ | ✓ |

---

## 一個 Request 的完整流程（以 `PUT /api/orders/:id` 為例）

### 1. `app/api/orders/[id]/route.ts`（入口）

Next.js 把請求交給 route handler。做三件事：

1. `requireAuth(req)` — 驗身份，拿到 `RequestContext`
2. `UpdateOrderBodySchema.safeParse(body)` — Zod 驗欄位格式，schema 加了 `.strict()` 讓未知欄位直接回 400
3. 呼叫 service，包裝成 `NextResponse.json()`

### 2. `modules/auth/require-auth.ts`（身份驗證）

從 `Authorization: Bearer dev:ROLE:userId` 解析出：

```ts
{ user: { id: "sales-A", role: "SALES" }, requestId: "..." }
```

### 3. `modules/order/order-service.ts`（業務邏輯 + 授權）

`updateOrderService` 做以下檢查，按順序 throw：

| 情況 | 錯誤 |
|---|---|
| 不是 SALES 或 ADMIN | 403 ForbiddenError |
| 找不到訂單 | 404 NOT_FOUND |
| SALES 試圖改 `status` | 403 ForbiddenError |
| SALES 改別人的訂單 | 403 ForbiddenError |
| SALES 改非 PENDING 的訂單 | 403 ForbiddenError |
| ADMIN 改不同 group 的訂單 | 403 ForbiddenError |

通過後呼叫 `updateOrder(db, id, input)`。

### 4. `infra/db/order-repository.ts`（DB 存取）

執行 Prisma query，回傳 `OrderRow`：

```ts
prisma.order.update({ where: { id }, data: { ...fields }, select: orderSelect })
```

### 5. 回傳 response

service → route handler → `NextResponse.json(updatedOrder)`，HTTP 200。

---

## 依賴方向

```
route handler
    → requireAuth()              # 確認是誰
    → zod safeParse              # 驗輸入格式
    → order-service / request-service
        → requireRole()          # role gate
        → getCallerGroup()       # group scope gate（ADMIN/SUPERADMIN 用）
        → order-repository / request-repository
    ← 回傳 response
```

---

## CSV 匯入格式

`POST /api/orders/import` 接受 multipart/form-data，欄位名稱 `file`：

```csv
name,type,dueDate,quantity
CustomerOrderA,A,2026-06-01,500
CustomerOrderB,B,2026-07-15,200
```

- `dueDate` 必須是合法日期字串
- `quantity` 必須是正整數
- 欄位缺失或格式錯誤的 row 會進 `errorList`，不影響其他 row
- 回傳：`{ successCount: number, errorList: string[] }`

---

## 申請核准邏輯（Approve Request）

`POST /api/requests/:id/approve` 呼叫後：

1. 載入申請的 `payload`（JSON，例如 `{ quantity: 2000 }`）
2. 把 payload 的欄位套用到關聯的 order（呼叫 `updateOrder`）
3. 只允許安全欄位（`quantity`, `name`, `type`, `dueDate`, `status`）；其他 payload key 忽略
4. 記錄 `lastModifiedById = ctx.user.id`

申請本身沒有「已核准」狀態，approve 是一次性動作直接改訂單。

---

## 錯誤對照

| 狀況 | HTTP | code |
|---|---|---|
| 未帶 token 或 token 無效 | 401 | `UNAUTHORIZED` |
| role 不符 | 403 | `FORBIDDEN` |
| 找不到資源 | 404 | `NOT_FOUND` |
| body 格式錯誤或未知欄位 | 400 | `BAD_REQUEST` |

---

## 軟刪除說明

`DELETE /api/orders` 不是真正刪除，而是把 `status` 設成 `CANCELLED`。
資料列永遠存在，可以用 `GET /api/orders/:id` 查到，狀態會是 `CANCELLED`。
沒有 `deletedAt` 欄位。
