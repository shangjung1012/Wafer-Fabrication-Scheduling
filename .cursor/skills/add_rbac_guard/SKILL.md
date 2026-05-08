# Skill: add RBAC guard (role + scope)

## Purpose

為新的資源/動作建立可重用的授權 guard（避免散落在每個 endpoint 的 if/else），並確保 SUPERADMIN/ADMIN/SALES 的 scope 一致。

## Inputs

- Resource：`order | factory | user | schedule | visualization`
- Action：`read | write | admin | assign`
- Expected roles（允許哪些角色）
- Scope rule（type/factory/orderPermission）
- Target identifiers（factoryId/orderId/userId）

## Steps

1. 在 `docs/domain_rbac.md` 補齊該 resource/action 的授權矩陣（若尚未定義）。
2. 定義 guard 的輸入/輸出介面（中性，不綁套件）：
   - input：`RequestContext` + target ids
   - output：允許/拒絕 + 可用的 scope（例如可見 orderIds）
3. 實作 scope 查詢邏輯（通常需要 DB lookup）：
   - ADMIN：factory scope
   - SUPERADMIN：type scope（跨三工廠）
   - SALES：order scope（applicant + OrderPermission）
4. 在 API handler 入口呼叫 guard：
   - 失敗：回 `403`（統一 error format）
5. 加測試：每個角色至少一個 allow/deny case。

## Output artifacts

- `modules/auth/*` 或 `modules/*` 的 guard function（依實際模組切分）
- 受影響的 `app/api/**/route.ts` 授權呼叫
- 測試
- `docs/domain_rbac.md` 更新（若有新增規則）

## Gotchas

- 不要把 scope 只放在 client 或 request body
- 若把 scope 放在 JWT claims，務必處理權限變更後 token 仍有效的風險（建議 DB 查）

