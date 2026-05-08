# Rule: scheduling & visualization changes

## Any scheduling change must update contracts

只要修改排程演算法/衝突邏輯/版本化策略，必須同步更新：
- `docs/scheduling_conflicts.md`
- `docs/visualization_contract.md`
- 相關 endpoints 的 `api_spec.yml` schema（至少新增/補齊欄位）

## Versioning (must for confirm/apply)

- 排程確認生效（confirm/apply）必須具備版本概念
- 版本不一致必須回 `409`

## Conflict visibility (must)

- server 必須回傳足夠資訊讓 UI 呈現 conflicts（類型、嚴重度、時間窗、影響訂單）

