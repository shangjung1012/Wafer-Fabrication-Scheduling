# Cursor Project Assets

本資料夾用來放「讓人/Agent 都能一致開發」的專案內資產：

- **docs/**: 架構、領域模型、JWT/RBAC、Prisma、排程、視覺化、DevOps 的參考文件
- **rules/**: 讓 Cursor/Agent 在生成或修改程式碼時遵守的硬規則（放檔位置、安全、DB 访问等）
- **skills/**: 專案高頻流程的可重用模板（新增 API、改 Prisma、加 RBAC、排程變更、發版）

## Quick links

- **Architecture**: `docs/architecture.md`
- **RBAC & Scope**: `docs/domain_rbac.md`
- **JWT Auth (neutral)**: `docs/auth_jwt.md`
- **API conventions**: `docs/api_conventions.md`
- **Prisma conventions**: `docs/prisma_conventions.md`
- **Orders lifecycle**: `docs/orders_lifecycle.md`
- **Scheduling & conflicts**: `docs/scheduling_conflicts.md`
- **Visualization contract**: `docs/visualization_contract.md`
- **DevOps runbook**: `docs/devops_runbook.md`

## How to use (team)

- 新功能開始前：先看 `docs/`，確認 domain/權限/資料契約假設。
- 寫 API 前：先看 `rules/02_security_rbac_jwt.md` 與 `docs/api_conventions.md`。
- 改 Prisma 前：先看 `docs/prisma_conventions.md`，並遵守 `rules/03_prisma_db_access.md`。
- 改排程/視覺化：先跑 `skills/scheduling_change_checklist/SKILL.md` 的 checklist。

## How to use (agent)

當你要請 Agent 幫忙時，建議在提示中附上：
- 目標 endpoint（對應 `api_spec.yml` 的 path/method）
- 角色/範圍需求（SUPERADMIN/ADMIN/SALES + type/factory/order）
- 你希望的輸出（route handler / module / prisma / UI）

