# Manual Edit Concurrency Control — Proposal

## TL;DR

將所有會影響排程的 manual edit 操作（drag-drop、order 欄位更新、刪除訂單）統一納入
`withScheduleLock` + `scheduleVersion` OCC 保護。

目前真正的空白有四處：

| 空白 | 影響 |
|------|------|
| `PATCH /api/assignments/bulk` 的 catch 缺 409 mapping | lock 搶不到時回 500 |
| `PATCH /api/assignments/bulk` 缺 OCC version check | UI stale view 可覆蓋較新的 DB 狀態 |
| `updateOrderService` schedule-affecting 更新缺 lock | 與 runSchedule cron 存在 race condition |
| `deleteOrdersService` 缺 lock | 同上 |

---

## 現況分析

### 已有保護的部分

```
withScheduleLock 覆蓋範圍（現在）:
  applyAssignmentMoves()   ← drag-drop ✅ (lock 已在 service layer)
  runSchedule()            ← /api/schedule/run ✅
  applyScheduleTransaction() ← /api/schedule/apply ✅ (含 OCC version check)
  cron runAutoScheduler    ← 透過 runSchedule() ✅
```

`scheduleVersion` 的角色：
- `incrementScheduleVersion(type)` 在每次 schedule-affecting 寫入後呼叫
- preview→apply 的 OCC 依賴它：apply 時比對 `expectedVersion`，不符 → 409
- **但** `runSchedule`（one-shot path）沒有 version check，lock 是唯一保護

### 現在的空白

**1. `PATCH /api/assignments/bulk` — catch 缺 409**

```typescript
// app/api/assignments/bulk/route.ts 現在的 catch:
catch (error) {
  if (error instanceof ManualEditValidationError) { /* 400 */ }
  if (error instanceof UnauthorizedError)         { /* 401 */ }
  if (error instanceof CsrfError)                 { /* 403 */ }
  // "already running" 不屬於以上任何一種 → fall through → 500
}
```

**2. `PATCH /api/assignments/bulk` — 無 OCC**

drag-drop 有 lock（串行化），但沒有 version check。若 UI 的 schedule view 已過時
（中間有其他寫入），drag-drop 仍可成功提交。preview→apply 有這個保護，drag-drop 沒有。

**3. `updateOrderService` — schedule-affecting 更新無 lock**

Race condition 場景：

```
T=0  runSchedule(type=A) 開始，讀取 order O1: { isFixed: false, quantity: 500 }
T=1  ADMIN PUT /api/orders/O1 { isFixed: true } → incrementScheduleVersion(A)
T=2  runSchedule 繼續以 isFixed=false 排程 O1
T=3  runSchedule 寫入 DB：O1 被排入並標為 SCHEDULED
T=4  DB 狀態：O1.isFixed=true 但已被排程（語意矛盾）
```

對 preview→apply 流程，`incrementScheduleVersion` 在 T=1 就讓 preview 失效，apply 時
會 409 → 需重新 preview。**但 `runSchedule`（cron path）是 one-shot，沒有 version check，
無法被 OCC 擋住。**

schedule-affecting 欄位定義（與現有 `affectsSchedule()` 一致）：

```typescript
function affectsSchedule(input): boolean {
  return (
    input.status     !== undefined ||  // ← CANCELLED path
    input.dueDate    !== undefined ||
    input.quantity   !== undefined ||
    input.isFixed    !== undefined ||
    input.isPrioritized !== undefined
  );
  // name 不在此列 → name-only 更新不需要 lock
}
```

**4. `deleteOrdersService` — 無 lock**

`deleteOrdersService` 呼叫 `cancelOrdersAndReleaseCapacity`（含 Prisma transaction）後再
`incrementScheduleVersion`。若與 `runSchedule` 並發，排程可能讀到已被刪除（或正在被刪除）
的 order。

---

## 設計決策

### Lock 位置：Service Layer

與現有 `applyAssignmentMoves` 一致，lock 放在 service layer，不放在 route handler。
Route handler 只負責 `"already running"` → 409 的 error mapping。

### OCC for Drag-Drop

**Request body 新增 `expectedVersions: Record<string, number>`（optional）**

```
PATCH /api/assignments/bulk
{
  "moves": [...],
  "expectedVersions": { "A": 5 }   ← UI 載入時記錄的版本
}
```

Server 在 `withScheduleLock` 內部，執行 validation 之前先比對版本：

```
withScheduleLock(types, async () => {
  // 1. OCC check（如果 client 有提供）
  for each type in types:
    current = await getScheduleVersion(type)
    if expectedVersions[type] !== undefined && current !== expectedVersions[type]:
      throw Error("environment has changed: schedule was modified, please reload")

  // 2. 現有的 validation + transaction
  ...
})
```

`"environment has changed"` 的 error 訊息與 `POST /api/schedule/apply` 已有的邏輯完全
一致，route catch 的 409 mapping 也共用同一條件：

```typescript
if (
  error instanceof Error &&
  (error.message?.includes("already running") ||
   error.message?.includes("environment has changed"))
) {
  return NextResponse.json({ code: "CONFLICT", message: error.message }, { status: 409 });
}
```

`expectedVersions` 為 optional，不傳時僅靠 lock 保護（向後相容）。

### updateOrderService 的 Lock 範圍

Lock 只包住實際的寫入 + `incrementScheduleVersion`，permission check 留在外面
（permission check 依賴 `order.type` 等不可變欄位，不需要在 lock 內重讀）：

```
┌── 外部 ──────────────────────────────────────────────────────────────┐
│ findOrderById()         ← type discovery + permission check         │
│ validateOrderQuantity() ← input validation                          │
│ assertOrderStatusTransition()                                        │
├── withScheduleLock(order.type) ──────────────────────────────────────┤
│   updateOrder() / cancelOrdersAndReleaseCapacity()                  │
│   incrementScheduleVersion()                                         │
└──────────────────────────────────────────────────────────────────────┘
```

**例外**：name-only 更新（`affectsSchedule` 為 false）不加 lock。

### deleteOrdersService 的 Lock 範圍

`deleteOrdersService` 可能跨多個 type（刪除不同 type 的訂單），與
`applyAssignmentMoves` 相同，使用排序後的多 type lock：

```
types = [...new Set(orders.map(o => o!.type))]  // e.g. ["A", "C"]
withScheduleLock(types, async () => {
  await cancelOrdersAndReleaseCapacity(db, ids)
  for (const type of types) await incrementScheduleVersion(type)
  return result
})
```

`withScheduleLock` 內部已做 `.sort()` 固定順序，不會 deadlock。

---

## 逐檔案變更

### 1. `modules/schedule/manual-edit-service.ts`

**新增 `expectedVersions` 參數：**

```diff
 export async function applyAssignmentMoves(
   db: PrismaClient,
   moves: AssignmentMove[],
   actorUserId: string,
+  expectedVersions?: Record<string, number>,
 ): Promise<AssignmentMoveResult> {
```

**在 lock 內、validation 之前插入 OCC check：**

```diff
   return withScheduleLock(types, async () => {
+    // OCC: reject if schedule was modified since UI loaded
+    if (expectedVersions) {
+      for (const type of types) {
+        if (expectedVersions[type] !== undefined) {
+          const current = await getScheduleVersion(type);
+          if (current !== expectedVersions[type]) {
+            throw new Error(
+              `environment has changed: schedule was modified for type ${type}, please reload`,
+            );
+          }
+        }
+      }
+    }
+
     const violations: ManualEditViolation[] = [];
     ...
```

需要新增 `getScheduleVersion` import（`infra/redis/schedule-store` 已有此 export）。

---

### 2. `app/api/assignments/bulk/route.ts`

**Schema 新增 `expectedVersions`：**

```diff
 const BulkMoveSchema = z.object({
   moves: z.array(MoveSchema).min(1),
+  expectedVersions: z.record(z.string(), z.number()).optional(),
 });
```

**傳遞給 `applyAssignmentMoves`：**

```diff
-    const result = await applyAssignmentMoves(prisma, parsed.data.moves, ctx.user.id);
+    const result = await applyAssignmentMoves(
+      prisma,
+      parsed.data.moves,
+      ctx.user.id,
+      parsed.data.expectedVersions,
+    );
```

**Catch 新增 409 mapping（在 `ManualEditValidationError` 之前）：**

```diff
+    if (
+      error instanceof Error &&
+      (error.message?.includes("already running") ||
+       error.message?.includes("environment has changed"))
+    ) {
+      return NextResponse.json(
+        { code: "CONFLICT", message: error.message },
+        { status: 409 },
+      );
+    }
     if (error instanceof ManualEditValidationError) {
```

---

### 3. `modules/order/order-service.ts`

**import 新增 `withScheduleLock`：**

```diff
-import { incrementScheduleVersion } from "@/infra/redis/schedule-store";
+import {
+  withScheduleLock,
+  incrementScheduleVersion,
+} from "@/infra/redis/schedule-store";
```

**SALES branch — 在 `affectsSchedule` 為 true 時加 lock：**

```diff
-    const result = await updateOrder(db, id, salesInput);
-    if (!result) orderNotFound();
-    if (affectsSchedule(salesInput)) {
-      await incrementScheduleVersion(order.type);
-    }
-    return result;
+    if (affectsSchedule(salesInput)) {
+      return withScheduleLock(order.type, async () => {
+        const result = await updateOrder(db, id, salesInput);
+        if (!result) orderNotFound();
+        await incrementScheduleVersion(order.type);
+        return result;
+      });
+    }
+    const result = await updateOrder(db, id, salesInput);
+    if (!result) orderNotFound();
+    return result;
```

**ADMIN CANCELLED branch — 加 lock：**

```diff
   if (input.status === OrderStatus.CANCELLED) {
-    const result = await cancelOrdersAndReleaseCapacity(db, [id]);
-    if (result.count === 0) orderNotFound();
-    const cancelledOrder = await findOrderById(db, id);
-    if (!cancelledOrder) orderNotFound();
-    await incrementScheduleVersion(order.type);
-    return cancelledOrder;
+    return withScheduleLock(order.type, async () => {
+      const result = await cancelOrdersAndReleaseCapacity(db, [id]);
+      if (result.count === 0) orderNotFound();
+      const cancelledOrder = await findOrderById(db, id);
+      if (!cancelledOrder) orderNotFound();
+      await incrementScheduleVersion(order.type);
+      return cancelledOrder;
+    });
   }
```

**ADMIN 一般更新 branch — 在 `affectsSchedule` 為 true 時加 lock：**

```diff
-  const result = await updateOrder(db, id, adminInput);
-  if (!result) orderNotFound();
-  if (affectsSchedule(adminInput)) {
-    await incrementScheduleVersion(order.type);
-  }
-  return result;
+  if (affectsSchedule(adminInput)) {
+    return withScheduleLock(order.type, async () => {
+      const result = await updateOrder(db, id, adminInput);
+      if (!result) orderNotFound();
+      await incrementScheduleVersion(order.type);
+      return result;
+    });
+  }
+  const result = await updateOrder(db, id, adminInput);
+  if (!result) orderNotFound();
+  return result;
```

**`deleteOrdersService` — 加 lock：**

```diff
   const orders = await Promise.all(ids.map((id) => findOrderById(db, id)));
   for (const order of orders) {
     if (!order || order.type !== group) {
       throw new ForbiddenError("One or more orders are not in your production group.");
     }
   }

-  const result = await cancelOrdersAndReleaseCapacity(db, ids);
-  for (const type of new Set(orders.map((o) => o!.type))) {
-    await incrementScheduleVersion(type);
-  }
-  return result;
+  const types = Array.from(new Set(orders.map((o) => o!.type)));
+  return withScheduleLock(types, async () => {
+    const result = await cancelOrdersAndReleaseCapacity(db, ids);
+    for (const type of types) {
+      await incrementScheduleVersion(type);
+    }
+    return result;
+  });
```

---

### 4. `app/api/orders/[id]/route.ts` (PUT)

```diff
   } catch (err) {
+    const e = err as { message?: string };
+    if (
+      err instanceof Error &&
+      err.message?.includes("already running")
+    ) {
+      return NextResponse.json(
+        { code: "CONFLICT", message: err.message },
+        { status: 409 },
+      );
+    }
     if (err instanceof UnauthorizedError) return unauthorizedResponse(err.message);
```

---

### 5. `app/api/orders/route.ts` (DELETE)

```diff
   } catch (err) {
+    if (
+      err instanceof Error &&
+      err.message?.includes("already running")
+    ) {
+      return NextResponse.json(
+        { code: "CONFLICT", message: err.message },
+        { status: 409 },
+      );
+    }
     if (err instanceof UnauthorizedError) return unauthorizedResponse(err.message);
```

---

## 完整 Lock + OCC 互斥矩陣（實作後）

| 操作 | Lock keys | OCC check | 409 條件 |
|------|-----------|-----------|---------|
| `PATCH /api/assignments/bulk` | `schedule:lock:{type...}` | `expectedVersions` vs `getScheduleVersion` | already running / environment has changed |
| `PUT /api/orders/[id]` (schedule-affecting) | `schedule:lock:{order.type}` | 無（依賴 lock） | already running |
| `DELETE /api/orders` | `schedule:lock:{type...}` | 無（依賴 lock） | already running |
| `POST /api/schedule/run` | `schedule:lock:{type}` | 無 | already running |
| `POST /api/schedule/apply` | `schedule:lock:{type}` | `expectedVersion` vs `getScheduleVersion` | already running / environment has changed |
| Cron `runAutoScheduler` | `schedule:lock:{type}` | 無 | log-and-skip |

**不在範圍內**（lock 不必要）：
- `POST /api/orders`（createOrderService）：只新增 PENDING 訂單 + incrementVersion，不改現有 schedule 狀態
- `name`-only `PUT /api/orders/[id]`：`affectsSchedule` 為 false，不需 lock

---

## 不需要修改的部分

- `withScheduleLock` 本身：已支援多 type、fail-fast、TTL 保護、Lua CAS 釋放
- `infra/redis/schedule-store.ts`：`getScheduleVersion` 已 export，直接使用
- `cancelOrdersAndReleaseCapacity`：純 DB function，lock 由呼叫端持有即可
- `applyScheduleTransactionWithIssues` / `runScheduleWithIssues`：不改

---

## 實作步驟

1. `modules/schedule/manual-edit-service.ts`
   - 加 `expectedVersions` 參數
   - lock 內插入 OCC check（需新增 `getScheduleVersion` import）

2. `app/api/assignments/bulk/route.ts`
   - Schema 加 `expectedVersions`
   - 傳遞給 `applyAssignmentMoves`
   - catch 加 409 mapping

3. `modules/order/order-service.ts`
   - import `withScheduleLock`
   - SALES branch：`affectsSchedule` 為 true 時加 lock
   - ADMIN CANCELLED branch：加 lock
   - ADMIN 一般更新 branch：`affectsSchedule` 為 true 時加 lock
   - `deleteOrdersService`：提取 `types`，wrap in lock

4. `app/api/orders/[id]/route.ts`
   - PUT catch：加 "already running" → 409

5. `app/api/orders/route.ts`
   - DELETE catch：加 "already running" → 409

6. `pnpm lint && pnpm test`

7. 補測試（見下節）

---

## 測試計劃

### 新增 / 補強的測試

**`__tests__/api/assignments/bulk.test.ts`（新檔或現有）**

| Case | Mock | 預期 |
|------|------|------|
| lock 被佔用時 | `withScheduleLock` throw `"already running"` | 409 CONFLICT |
| version mismatch | `getScheduleVersion` 回傳 ≠ expectedVersions | 409 CONFLICT |
| 無 expectedVersions | `getScheduleVersion` 不被呼叫 | 200（只靠 lock） |

**`__tests__/modules/order/order-service.test.ts`**

| Case | Mock | 預期 |
|------|------|------|
| updateOrderService isFixed=true 時取得 lock | spy `withScheduleLock` | lock 被呼叫，type 正確 |
| updateOrderService lock 被佔用 | `withScheduleLock` throw `"already running"` | error propagate |
| updateOrderService name-only 不取 lock | spy `withScheduleLock` | lock 不被呼叫 |
| deleteOrdersService 取得 lock（multi-type） | spy `withScheduleLock` | lock 被呼叫，types 正確 |

**`__tests__/api/orders/`**

| Case | Mock | 預期 |
|------|------|------|
| PUT schedule-affecting lock 搶不到 | `withScheduleLock` throw | 409 |
| DELETE lock 搶不到 | `withScheduleLock` throw | 409 |

模式可參考 `__tests__/api/schedule/apply.test.ts` 的 "already running" 測試。
