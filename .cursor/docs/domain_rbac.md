# Domain RBAC & Scope

本文件定義「角色（RBAC）+ 範圍（Scope）」如何套用在資料層（type / factory / order）上。

## Organization model (your description)

- 系統有三種 **Type**（A/B/C）對應 `Factory.productionType` 與 `Order.type`
- 每個 Type 底下有三間工廠（Factory1/2/3）以及一個 **SUPERADMIN**
- 每間工廠有一位 **ADMIN**
- SUPERADMIN 管理該 type 下的所有 admins；也擁有 admin 的所有權限
- ADMIN 管理該工廠下的所有業務（SALES）
- SALES 只能看到訂單狀態（以及被允許看到的訂單）

> Prisma 目前的 RBAC 主要靠 `User.role`；scope 的資料分散在 `Factory.adminId`、`User.group`、`OrderAssignment.factoryId`。

## Roles (as of Prisma enum `UserRole`)

- **SALES**: 檢視訂單（受 scope 限制）；提交/修改申請（`OrderRequest`）
- **ADMIN**: 管理單一工廠的訂單與排程（CRUD + schedule adjust）
- **SUPERADMIN**: 管理該 type 下所有工廠；包含「分配訂單到工廠」與 RBAC 管理

## Scopes (recommended)

把授權拆成三個可組合的 scope：

- **type scope**: 使用者所屬 production type（A/B/C）
- **factory scope**: 使用者可管理/檢視的 factory IDs
- **order scope**: 使用者可檢視/操作的 order IDs（SALES：`Order.applicantId = user.id`）

### Scope sources (mapping to current schema)

- `type scope`:
  - 方案 A（推薦）：在 `User.group` 存 `productionType`（A/B/C）或 `type:<A>`
  - 方案 B：由 admin 綁定的 factories 推導 type（若每個 factory 有 productionType）
- `factory scope`:
  - ADMIN/SUPERADMIN：由 `Factory.adminId = user.id` 或「superadmin 持有該 type 的全部 factories」推導
- `order scope`:
  - SALES：由 `Order.applicantId = user.id` 決定（只能看到自己建立的訂單）

## Authorization decision order

建議每個受保護 action 的判斷順序：

1. **Authenticate**：JWT 有效、未過期、`sub` 存在
2. **Role gate**：role 是否允許該 action（read/write/admin/assign）
3. **Scope gate**：type/factory/order 是否落在允許範圍
4. **Data invariants**：狀態機與一致性（例：不能從 COMPLETED 回到 IN_PRODUCTION）

## Action matrix (minimal)

| Action | SALES | ADMIN | SUPERADMIN |
|---|---:|---:|---:|
| View orders list | limited | factory-only | type-wide |
| View order detail | limited | factory-only | type-wide |
| Create/Update request (`OrderRequest`) | yes | optional | optional |
| Import/Modify/Delete orders | no | yes (factory) | yes (type) |
| Update schedule | no | yes (factory) | yes (type) |
| Assign order to factory | no | no | yes |
| Manage users/permissions | no | no | yes (type) |

> 這張表是「產品規格」；授權實作見 `docs/auth_service_guide.md`。

