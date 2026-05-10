# Auth & RBAC 使用指南

給撰寫 order、schedule 或其他 service 的組員參考。

## 概念

授權分三層，各司其職：

```
modules/auth/require-auth.ts   → 解析 token，建立 RequestContext（你是誰）
modules/auth/rbac.ts           → requireRole()，角色白名單
modules/auth/scope.ts          → resolveActorScope()，查 DB 確認你能存取什麼範圍
```

授權邏輯**放在 service 層**，不放在 route handler。這樣不管從 API route 還是其他地方呼叫 service，授權都一定會執行，無法被繞過。

---

## 標準流程

每個 service 方法的授權步驟：

```
1. requireRole()         → 這個 action 允許哪些角色？
2. resolveActorScope()   → 這個 caller 的資料範圍是什麼？
3. assert*Access()       → 這個特定資源在他的範圍內嗎？（單筆操作才需要）
```

---

## Step 1：requireRole

```ts
import { requireRole } from "@/modules/auth/rbac";

// 只允許 ADMIN 和 SUPERADMIN
requireRole(ctx, ["ADMIN", "SUPERADMIN"]);

// 只允許 SUPERADMIN
requireRole(ctx, ["SUPERADMIN"]);
```

不在白名單內的 role 會收到 403。通常放在 service 方法的第一行。

---

## Step 2：resolveActorScope

```ts
import { resolveActorScope, type ActorScope } from "@/modules/auth/scope";

const scope = await resolveActorScope(ctx, db);
```

回傳的 `ActorScope` 是 union type，依 role 不同內容不同：

```ts
// SALES
{ role: "SALES", userId: string, group: string }

// ADMIN
{ role: "ADMIN", userId: string, factoryId: string, productionType: string }

// SUPERADMIN
{ role: "SUPERADMIN", userId: string, group: string }
```

取得 scope 之後，直接用來建立 DB 查詢的 WHERE 條件：

```ts
const scope = await resolveActorScope(ctx, db);

// list 查詢：把 scope 轉成 filter
const filter = (() => {
  switch (scope.role) {
    case "SALES":      return { applicantId: scope.userId };
    case "ADMIN":      return { factoryId: scope.factoryId };
    case "SUPERADMIN": return { type: scope.group };
  }
})();

const items = await findSomething(db, filter);
```

這個做法的好處是越權的資料根本查不出來，不需要額外的 if/throw。

---

## Step 3：assertXAccess（單筆資源的存取驗證）

GET /orders/:id 或 PATCH /schedule/:id 這類操作，要先 fetch 資源，再確認 caller 有權限存取它。在你的 service 檔案裡自訂這個 assert function：

```ts
// 範例：schedule-service.ts 的 factory 存取驗證
function assertFactoryAccess(factory: FactoryRow, scope: ActorScope): void {
  switch (scope.role) {
    case "SALES":
      // SALES 沒有 factory 層級的存取
      throw new ForbiddenError("SALES role does not have factory-level access.");

    case "ADMIN":
      // ADMIN 只能存取自己管理的工廠
      if (factory.id !== scope.factoryId) {
        throw new NotFoundError("Factory not found.");  // 用 404 避免洩漏資源存在
      }
      break;

    case "SUPERADMIN":
      // SUPERADMIN 只能存取同 type 的工廠
      if (factory.productionType !== scope.group) {
        throw new NotFoundError("Factory not found.");
      }
      break;
  }
}
```

**重要：** 越權存取回 `NotFoundError`（404），不要回 `ForbiddenError`（403）。403 會洩漏「資源存在但你沒權限」的資訊，404 則不會。

---

## 完整範例：schedule-service.ts

```ts
import type { PrismaClient } from "@/lib/generated/prisma/client";
import type { RequestContext } from "@/modules/auth/request-context";
import { requireRole, ForbiddenError, NotFoundError } from "@/modules/auth/rbac";
import { resolveActorScope, type ActorScope } from "@/modules/auth/scope";

// 假設已有 infra/db/schedule-repository.ts
import { findSchedule, updateSchedule, type ScheduleRow } from "@/infra/db/schedule-repository";

// ── 1. 自訂這個 service 的 resource access check ──────────────────────────

function assertFactoryAccess(factory: { id: string; productionType: string }, scope: ActorScope): void {
  switch (scope.role) {
    case "SALES":
      throw new ForbiddenError("SALES role does not have schedule access.");
    case "ADMIN":
      if (factory.id !== scope.factoryId) throw new NotFoundError("Schedule not found.");
      break;
    case "SUPERADMIN":
      if (factory.productionType !== scope.group) throw new NotFoundError("Schedule not found.");
      break;
  }
}

// ── 2. Service methods ────────────────────────────────────────────────────

export async function getSchedule(
  ctx: RequestContext,
  db: PrismaClient,
  factoryId: string
) {
  // Step 1: role gate（SALES 不能看排程）
  requireRole(ctx, ["ADMIN", "SUPERADMIN"]);

  // Step 2: 解析 scope
  const scope = await resolveActorScope(ctx, db);

  // 查資源
  const schedule = await findSchedule(db, factoryId);
  if (!schedule) throw new NotFoundError("Schedule not found.");

  // Step 3: 確認有權存取這個 factory
  assertFactoryAccess(schedule.factory, scope);

  return schedule;
}

export async function updateScheduleService(
  ctx: RequestContext,
  db: PrismaClient,
  factoryId: string,
  input: { date: Date; quantity: number }
) {
  requireRole(ctx, ["ADMIN", "SUPERADMIN"]);
  const scope = await resolveActorScope(ctx, db);

  const schedule = await findSchedule(db, factoryId);
  if (!schedule) throw new NotFoundError("Schedule not found.");

  assertFactoryAccess(schedule.factory, scope);

  return updateSchedule(db, factoryId, input);
}
```

---

## Error Classes

全部從 `modules/auth/rbac.ts` import：

```ts
import { ForbiddenError, NotFoundError } from "@/modules/auth/rbac";
```

| Class | HTTP | 使用時機 |
|---|---|---|
| `ForbiddenError` | 403 | role 不符、明確的操作被禁止 |
| `NotFoundError` | 404 | 資源不存在、**或越權存取**（避免洩漏） |

Route handler 負責把這些 error 轉成 HTTP response，service 只需要 throw，不用處理 HTTP。

---

## Route Handler 的標準寫法

```ts
import { requireAuth, UnauthorizedError } from "@/modules/auth/require-auth";
import {
  ForbiddenError, NotFoundError,
  forbiddenResponse, unauthorizedResponse, notFoundResponse,
} from "@/modules/auth/rbac";

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    const result = await yourService(ctx, prisma, ...);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof UnauthorizedError) return unauthorizedResponse(err.message);
    if (err instanceof ForbiddenError)    return forbiddenResponse(err);
    if (err instanceof NotFoundError)     return notFoundResponse(err.message);
    throw err;  // 未預期的錯誤往上拋，讓 Next.js 回 500
  }
}
```

---

## 檔案位置總覽

```
modules/auth/
  ├── require-auth.ts   token 解析（requireAuth）
  ├── request-context.ts  RequestContext / AuthUser 型別
  ├── rbac.ts           requireRole、ForbiddenError、NotFoundError、response helpers
  └── scope.ts          resolveActorScope、ActorScope 型別

infra/db/
  ├── user-repository.ts
  └── order-repository.ts   參考這個檔案的寫法新增你的 repository

modules/orders/
  └── order-service.ts   參考這個檔案的 RBAC 模式
```
