# Skill: scheduling change checklist

## Purpose

任何排程/衝突/視覺化邏輯改動前後，都用同一份 checklist 確保一致性、可回溯與 UI 不壞。

## Inputs

- 變更描述（演算法/規則/資料來源/輸出欄位）
- 影響範圍（哪個 type/factory、哪些 endpoints）
- 是否改動資料模型（Prisma）

## Checklist

### A) Domain & invariants

- [ ] 變更是否影響 `OrderStatus` 狀態機？（見 `docs/orders_lifecycle.md`）
- [ ] 是否新增/修改 conflict 類型？是否有嚴重度（WARN/ERROR）？
- [ ] 是否影響 `Factory.maxCapacity/curCapacity` 的計算方式？

### B) API & contracts

- [ ] `/schedule/*`（若有）是否需要新增 preview/confirm 的欄位？
- [ ] `/visualization/timeline` 的 `timeline/conflicts/diffs` 是否新增欄位？
- [ ] `api_spec.yml` 是否同步更新 schema？
- [ ] `docs/scheduling_conflicts.md`、`docs/visualization_contract.md` 是否同步更新？

### C) Consistency & concurrency

- [ ] confirm/apply 是否維持版本化（expectedVersion → newVersion）？
- [ ] 是否有可能產生版本衝突？（回 `409`）
- [ ] 是否需要 transaction？

### D) Testing

- [ ] 至少一個有衝突的案例（conflicts 不為空）
- [ ] 至少一個無衝突的案例（可排程）
- [ ] 401/403 coverage（權限）

## Output artifacts

- code changes（modules/infra/app/api）
- 更新後的 docs/contracts
- 更新後的 `api_spec.yml`
- tests

