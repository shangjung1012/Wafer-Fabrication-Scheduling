# Merge 紀錄：feat/schedule → feat/conflict-visual

## 背景

將 `feat/schedule` merge 進 `feat/conflict-visual` 時，有幾個衝突需要手動解決。
本文件說明每個更動的原因，方便雙方對齊。

---

## 1. vitest.config.ts — 路徑解析改為原生方式

### 你的版本（feat/schedule）

```ts
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./"),
    },
  },
});
```

### 我的更動後

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["dotenv/config"],
  },
});
```

### 原因

**手動 alias 的問題：** 你的版本只映射 `@` → 根目錄，但 `tsconfig.json` 裡有一條特殊映射：

```json
"@/lib/generated/prisma": ["./lib/generated/prisma/client"]
```

Prisma 產生的 client 路徑比較特殊，手動 alias 會導致 `@/lib/generated/prisma/client` 被錯誤解析（`@/lib/generated/prisma` 這個 alias 太貪婪，會攔截到更長的路徑），讓所有 test 因為找不到 Prisma module 而失敗。

**`resolve.tsconfigPaths: true` 的優點：**

- Vite 4.4+ 的原生功能，不需要額外 dependency
- 自動同步 `tsconfig.json` 的所有 `paths`，包含 Prisma 的特殊映射
- 之前用的 `vite-tsconfig-paths` plugin 也是做同樣的事，Vite 現在直接內建了

**補回被移除的設定：** 你的版本移除了 `globals: true` 和 `setupFiles: ["dotenv/config"]`，這兩個是我們的 integration test 跑起來的必要條件（dotenv 用來讀 `DATABASE_URL`，globals 讓 `describe/it/expect` 不用每次都 import）。

---

## 2. infra/db/order-repository.ts — 保留原有 functions

### 你的版本（feat/schedule）

整個檔案被改成只剩一個 function：

```ts
export async function findOrdersForScheduling(db, type) { ... }
```

### 我的處理

保留原有所有 order management functions（`findOrders`、`findOrderById`、`createOrder`、`updateOrder`、`deleteOrders`），並把你的 `findOrdersForScheduling` 加到檔案尾端。

原有的 functions 是 order API 的核心依賴，移除會讓整個訂單管理功能壞掉。

---

## 3. **tests**/integration/schedule-engine.test.ts — DB 隔離修正

### 問題

你的 `beforeEach` 做了全表清空：

```ts
await prisma.user.deleteMany();
await prisma.factory.deleteMany();
await prisma.order.deleteMany();
// ...
```

這會在每個測試前把整個 DB 清空，導致我們 rbac test 依賴的 seed 資料（`sales-A`、`admin-A1` 等）也一起被刪掉，所有 rbac test 因此失敗。

### 修正

把 `deleteMany` 加上 scope，只清這個 suite 自己建的資料：

```ts
await prisma.orderAssignment.deleteMany({
  where: { factory: { productionType: "IntegrationType" } },
});
await prisma.dailyCapacity.deleteMany({
  where: { factory: { productionType: "IntegrationType" } },
});
await prisma.order.deleteMany({ where: { type: "IntegrationType" } });
await prisma.factory.deleteMany({
  where: { productionType: "IntegrationType" },
});
await prisma.user.deleteMany({ where: { name: "Test Applicant" } });
```

你的測試用 `productionType: "IntegrationType"` 和 `name: "Test Applicant"` 建資料，用這兩個條件 scope 就能精準清除，不影響 seed 資料。

---

## 4. 測試目錄整理

將 `tests/rbac/` 下的檔案移到 `__tests__/rbac/`，讓所有 test 統一放在 `__tests__/` 下：

```
__tests__/
  api/schedule/            ← 你的
  integration/             ← 你的
  modules/schedule/        ← 你的
  rbac/                    ← 我的（從 tests/rbac/ 移過來）
    order-rbac.test.ts
    visualization-rbac.test.ts
```

---

## 驗證（merge 衝突解決後）

Merge 衝突解完後跑 `pnpm test`，全部 37 tests 通過。

---

---

# Merge 後追加的重構

以下是 merge 完成之後額外做的修改，與衝突解決無關，但影響到你的 code。

---

## 5. infra/db/ — 補齊 repository 層（架構一致性）

### 問題

`engine.ts` 的 transaction 寫入操作直接使用 raw Prisma（`tx.order.update`、`tx.orderAssignment.createMany` 等），繞過了 `infra/db/` repository 層。這與專案的架構規定衝突（`.cursor/rules/03_prisma_db_access.md`：所有 DB access 須透過 repository）。

### 新增的 repository files

**`infra/db/assignment-repository.ts`**（新增）

```ts
deleteScheduledAssignments(db, orderIds); // 取代 tx.orderAssignment.deleteMany
createAssignments(db, assignments); // 取代 tx.orderAssignment.createMany
```

**`infra/db/capacity-repository.ts`**（新增）

```ts
createDailyCapacities(db, capacities); // 取代 tx.dailyCapacity.createMany
updateDailyCapacityById(db, id, cur); // 取代 tx.dailyCapacity.update
```

**`infra/db/order-repository.ts`**（加一個 function）

```ts
bulkUpdateOrderStatus(db, updates); // 取代 engine 內的 tx.order.update loop
```

**`infra/db/factory-repository.ts`**（修正）

- import 路徑從 `@/lib/generated/prisma/client` 改為 `@/lib/generated/prisma`（對齊其他 repository）
- `db: PrismaClient | any` 改為 `db: PrismaClient`

### engine.ts 的更動

```ts
// 之前（raw Prisma）
await tx.orderAssignment.deleteMany({ where: { ... } });
await tx.order.update({ where: { id }, data: { status } });

// 之後（透過 repository）
await deleteScheduledAssignments(db, processedOrderIds);
await bulkUpdateOrderStatus(db, [...]);
```

Transaction 內用 `tx as unknown as PrismaClient` 來 cast，這是 Prisma 社群對 transaction client 型別的標準做法（`TransactionClient` 不直接繼承 `PrismaClient`，但 model 方法完全相容）。

---

## 6. **tests**/modules/schedule/engine.test.ts — 更新 mock 對象

### 原因

原本的 test 驗的是 raw Prisma 呼叫（`prismaMockTx.orderAssignment.deleteMany` 等）。重構後 engine 改呼叫 repository functions，test 需要跟著更新。

### 更動方向

- 新增 `vi.mock("@/infra/db/assignment-repository")` 和 `vi.mock("@/infra/db/capacity-repository")`
- `vi.mock("@/infra/db/order-repository")` 補上 `bulkUpdateOrderStatus: vi.fn()`
- Assertions 從驗底層 Prisma 方法改為驗 repository function 呼叫

```ts
// 之前
expect(prismaMockTx.orderAssignment.deleteMany).toHaveBeenCalledWith({ ... });

// 之後
expect(assignmentRepo.deleteScheduledAssignments).toHaveBeenCalledWith(mockTx, ["O1", "O2"]);
```

---

## 7. Redis 環境設定

Schedule engine 使用 `ioredis` 做分散式鎖（防止排程重複觸發），需要 Redis。

**`.env.example`** 新增：

```
REDIS_URL="redis://localhost:6379"
```

**`docker-compose.yml`** 新增 Redis service：

```yaml
redis:
  image: redis:7-alpine
  container_name: wafer_redis
  ports:
    - "6379:6379"
```

記得把 `REDIS_URL` 加進你自己的 `.env`，並執行 `docker compose up -d` 啟動 Redis。

---

## 最終驗證

全部更動完成後跑 `pnpm test`：

```
Test Files  6 passed (6)
     Tests  37 passed (37)
```

---

---

# Merge 後追加：RBAC 重構 + 訂單排程流程

以下是在 visualization 功能穩定後，對整體 RBAC 架構做的重新設計。

---

## 8. Schema 改為 Admin-Factory N-to-N

### 問題

原本 `Factory.adminId` 是 1-to-1 關係（一間工廠只能有一個 admin），且 ADMIN 的 scope 是 factory-scoped（只能看到自己那間工廠的資料）。

### 更動

**`prisma/schema.prisma`**

移除 `Factory.adminId`，改為 implicit many-to-many：

```prisma
// 移除
adminId String?
admin   User? @relation("FactoryAdmin", ...)

// 新增（自動建立 _FactoryAdmins junction table）
model Factory {
  admins User[] @relation("FactoryAdmins")
}
model User {
  managedFactories Factory[] @relation("FactoryAdmins")
}
```

**`modules/auth/scope.ts`**

`AdminScope` 的 `factoryId: string` 改為 `factoryIds: string[]`，scope 解析從 `findFirst({ adminId })` 改為 `findMany({ admins.some })`:

```ts
// 之前
factoryId: factory.id

// 之後
factoryIds: factories.map(f => f.id)
```

**`prisma/seed.ts`**

工廠 seed 從 `admin: { connect }` 改為 `admins: { connect: [...] }`，支援多個 admin。

---

## 9. ADMIN 權限提升至 type-wide

### 更動內容

| 功能 | 之前 | 之後 |
|------|------|------|
| Visualization 甘特圖 | ADMIN 只看自己工廠 | ADMIN 看整個 type（A1/A2/A3） |
| 管理 SALES 使用者 | SUPERADMIN only | ADMIN + SUPERADMIN |
| 建立/升級 ADMIN 使用者 | SUPERADMIN only | SUPERADMIN only（維持） |

**`modules/visualization/service.ts`**：移除 ADMIN factory-only 限制，ADMIN 和 SUPERADMIN 統一使用 type-wide scope。

**`modules/users/user-service.ts`**：四個 function 開放 ADMIN，但加 role guard——ADMIN 只能操作 SALES 使用者，不能建立或升級 ADMIN/SUPERADMIN 角色。

**`app/api/users/route.ts`**：GET/POST 從 SUPERADMIN-only 改為 ADMIN + SUPERADMIN。

---

## 10. 新增訂單到顯示在排程上的完整流程

```
1. SALES 建立訂單
   POST /api/orders
   → Order.status = PENDING

2. ADMIN 審核通過
   PUT /api/orders/:id { status: "APPROVED" }
   → Order.status = APPROVED
   → 此時沒有 assignment，還沒進入排程

3. ADMIN（或 SUPERADMIN）觸發排程引擎
   POST /api/schedule/run { type: "A" }
   → engine 撈出所有 APPROVED/SCHEDULED/IN_PRODUCTION 的 type A 訂單
   → greedyBestFitStrategy 分配工廠和日期（找剩餘產能最多的工廠）
   → 建立 OrderAssignment 記錄
   → 更新 DailyCapacity（扣除已用產能）
   → Order.status = SCHEDULED

4. Visualization 頁面自動刷新
   GET /api/visualization/timeline
   → 從 OrderAssignment + DailyCapacity 讀取資料
   → 計算衝突（CAPACITY / DUE_DATE）
   → 渲染甘特圖，新排入的訂單出現在對應工廠的格子上
```

### 注意事項

- 排程引擎以**整個 production type** 為單位跑，一次重新分配該 type 所有 APPROVED/SCHEDULED 訂單
- ADMIN 觸發時，`type` 從 token 的 userId 自動推導（e.g. `admin-A1` → type `A`）
- 排程結果受工廠剩餘產能影響，不保證排在哪間工廠——A1 的 ADMIN 觸發排程，訂單可能被分到 A2
- Visualization 的 **Run Schedule** 按鈕會在成功後自動重新整理甘特圖

---

## 最終驗證（RBAC 重構後）

```
Test Files  6 passed (6)
     Tests  37 passed (37)
```

API 行為確認：
- `ADMIN admin-A1` 看 `/visualization` → factory-A1/A2/A3 全部可見
- `ADMIN admin-A1` 建 SALES 使用者 → HTTP 201
- `ADMIN admin-A1` 建 ADMIN 使用者 → HTTP 403（正確攔截）
