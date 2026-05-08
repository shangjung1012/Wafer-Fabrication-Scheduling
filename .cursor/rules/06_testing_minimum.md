# Rule: testing minimums

本專案目前已安裝 `vitest` 與 `@testing-library/*`；後續新增功能時，至少要達到以下測試門檻。

## Minimum required tests

- **modules（商業邏輯）**：至少單元測試覆蓋核心決策（RBAC gates、狀態機、排程衝突判斷）
- **API handlers**：至少整合測試覆蓋：
  - 401（未登入）
  - 403（權限不足）
  - 400（輸入驗證）
  - 成功案例（200/201）

## Non-goals

- 不要求 UI snapshot test 作為最低門檻（可以後續再加）

