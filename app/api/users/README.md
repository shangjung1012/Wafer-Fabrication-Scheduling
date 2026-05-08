# /api/users

## Endpoints

| Method | Path | 說明 | 權限 |
|---|---|---|---|
| GET | `/api/users` | 列出使用者（`?role=` filter） | SUPERADMIN |
| POST | `/api/users` | 建立使用者 | SUPERADMIN |
| PATCH | `/api/users/:id` | 修改 name / role / group | SUPERADMIN |
| DELETE | `/api/users/:id` | 刪除使用者 | SUPERADMIN |

---

## Request 流程

以 `GET /api/users` 為例，一個 request 進來之後的完整流程：

### 1. `app/api/users/route.ts`（入口）

Next.js 把 HTTP request 交給這個 route handler。第一件事是呼叫 `requireAuth(req)`。

### 2. `modules/auth/require-auth.ts`（身份驗證）

從 `Authorization: Bearer <token>` header 取出 token，在 dev 環境下解析 `dev:SUPERADMIN:sa-A` 格式，回傳一個 `RequestContext`：

```ts
{ user: { id: "sa-A", role: "SUPERADMIN" }, requestId: "..." }
```

這個 context 往後傳給所有下層函式，任何地方都不會再去碰 request header。

### 3. `modules/users/user-service.ts`（業務邏輯 + 授權）

拿到 context 之後做兩件事：

**授權** — 呼叫 `requireRole(ctx, ["SUPERADMIN"])`，從 `modules/auth/rbac.ts` 檢查 role 是否符合，不符合直接 throw `ForbiddenError`。

**Scope 查詢** — 用 `ctx.user.id` 去 DB 查這個 SUPERADMIN 的 `group`（例如 `"A"`），確認他只能看到 Type A 的使用者。這一步需要一次 DB 查詢。

### 4. `infra/db/user-repository.ts`（DB 存取）

service 確認授權和 scope 之後，呼叫 `findUsers(db, { group: "A" })`，實際執行 Prisma query：

```ts
prisma.user.findMany({ where: { group: "A" }, select: { id, name, role, group } })
```

回傳原始 DB 資料給 service。

### 5. 回到 route handler，回傳 response

service 把資料回傳給 route handler，包成 `{ items: [...] }` 格式，用 `NextResponse.json()` 送出 200。

---

## 依賴方向

```
route handler
    → requireAuth()        # 確認是誰
    → user-service         # 確認可以做什麼、做什麼範圍
        → requireRole()    # role gate
        → DB 查 group      # scope gate
        → user-repository  # 實際撈資料
    ← 回傳 response
```

---

## 錯誤對照

| 狀況 | HTTP Status | code |
|---|---|---|
| 未帶 token 或 token 無效 | 401 | `UNAUTHORIZED` |
| role 不符或 scope 不符 | 403 | `FORBIDDEN` |
| 找不到指定使用者 | 404 | `NOT_FOUND` |
| request body 格式錯誤 | 400 | `BAD_REQUEST` |

錯誤在任何一層 throw 之後，route handler 的 catch 會接住並轉成對應的 HTTP status。
