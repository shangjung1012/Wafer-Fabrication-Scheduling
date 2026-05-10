# Rule: security, RBAC & JWT

任何涉及資料存取（尤其是寫入）的 API，都必須在 server-side 完成「身份驗證 + 授權」。

## Authentication (JWT)

- 受保護 endpoints 必須從 `Authorization: Bearer <token>` 取得 token
- 只接受 server-side secret/key 驗證（不可把 secret 暴露到 client bundle）
- 缺 token 或 token 無效：回 `401`

## Authorization (RBAC + scope)

- 一律以 server-side user context（token + DB）判斷：
  - `User.role`（SUPERADMIN/ADMIN/SALES）
  - `User.group`（production type A/B/C）
  - `Factory.adminId`（ADMIN 的工廠歸屬）
  - `OrderAssignment.factoryId`（訂單與工廠的對應）
- 實作模式見 `docs/auth_service_guide.md`
- 禁止依賴 request body/query 傳入 role/scope（可作為 filter 但不可作為權限來源）

## Minimum gates by endpoint category

- **Orders CRUD / import / delete**：至少要求 ADMIN（factory scope）或 SUPERADMIN（type scope）
- **Scheduling update/confirm**：至少要求 ADMIN（factory scope）或 SUPERADMIN（type scope）
- **Users & permissions management**：只允許 SUPERADMIN（type scope）
- **Sales request creation/update (`OrderRequest`)**：允許 SALES（order scope）

## Sensitive data handling

- 不回傳 `User.password`
- 不回傳任何 internal token/secret
- 任何錯誤訊息避免洩漏授權策略細節（但 `403` 可回傳必要的 `code`）

## Reference docs

- `docs/auth_jwt.md`
- `docs/domain_rbac.md`

