# Auth (JWT, neutral)

本文件定義「JWT-based authentication」的最小共識，避免綁死特定套件（NextAuth/Auth.js、自建、better-auth…皆可）。

## Team decision (current)

- **Algorithm**: `HS256`
- **Secret env**: `JWT_SECRET`（server-side only）
- **Access token TTL**: `60 minutes`

## Request contract

- 受保護 API 以 `Authorization: Bearer <token>` 傳遞 access token
- 缺 token 或 token 無效：回 `401`
- token 有效但權限不足：回 `403`

## JWT claims (recommended minimal)

token payload 建議至少包含：

- `sub`: user id（對應 Prisma `User.id`）
- `role`: `SUPERADMIN | ADMIN | SALES`（對應 Prisma enum）
- `iat`, `exp`: issued-at / expiry

可選（若你希望減少 DB lookup）：
- `productionType`: 使用者 type（A/B/C）
- `factoryIds`: 可管理/檢視的工廠清單（ADMIN/SUPERADMIN）

> 安全取捨：把 scope 放進 JWT 會提高效能但增加「權限變更後 token 仍有效」的風險。中性做法是 token 只放 `sub/role`，scope 由 DB 查。

## Verification responsibilities

在 `app/api/*` 的 route handler（或 middleware）做：

1. parse bearer token
2. verify signature
3. check `exp`
4. build `RequestContext`（提供給 modules）

推薦的中性介面（文件級，不綁實作）：

```ts
type AuthUser = {
  id: string
  role: "SUPERADMIN" | "ADMIN" | "SALES"
}

type RequestContext = {
  user: AuthUser
  requestId: string
}
```

## Refresh / session strategy (TBD)

本專案尚未決定 refresh token / rotating refresh / session store。等決定後，把以下項目補齊：

- refresh token 存放位置（httpOnly cookie vs local storage 禁止）
- token rotation 與 revoke（blacklist/allowlist）
- 多裝置登入管理（optional）

## Security minimums

- 不允許從 request body/query 取得 role/scope（必須從 token/DB）
- access token 過期時間固定為 `60 minutes`
- `JWT_SECRET` 只放在 server-side env（不要曝露到 client bundle）

