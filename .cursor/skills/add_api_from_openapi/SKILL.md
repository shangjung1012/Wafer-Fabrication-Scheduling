# Skill: add API from OpenAPI

## Purpose

把 `api_spec.yml` 內某個 endpoint（path + method）落地成 Next.js App Router route handler + module method，並維持輸入驗證、RBAC、錯誤格式一致。

## Inputs

- OpenAPI path（例：`/users/{id}/permissions`）
- HTTP method（GET/POST/PUT/DELETE）
- 需要的 role/scope（SUPERADMIN/ADMIN/SALES + type/factory/order）
- request schema（body/query/path params）
- response schema（成功/錯誤）

## Steps

1. 在 `api_spec.yml` 找到 endpoint 定義，確認 tags/summary/parameters/requestBody/responses。
2. 決定 route handler 檔案路徑（App Router）：
   - `app/api/.../route.ts`
3. 寫 input validation（建議 `zod`）：
   - path params、query、body
4. 取得 `RequestContext`（JWT → user）
5. 進行 RBAC + scope gate（見 `docs/domain_rbac.md`、`rules/02_security_rbac_jwt.md`）。
6. 呼叫 `modules/*` 對應 service function（不要在 handler 直接寫 DB）。
7. 統一 error format 與 status code（見 `docs/api_conventions.md`、`rules/04_api_style_error_handling.md`）。
8. 若修改了 response shape/schema，同步回寫 `api_spec.yml`。
9. 加最小測試（401/403/400/200）。

## Output artifacts

- `app/api/**/route.ts`
- `modules/**` 的 service method
-（必要時）`infra/db/**` repository helper
-（必要時）`api_spec.yml` schema 補齊
- 測試檔（依測試架構）

## Gotchas

- 不要相信 client 傳的 role/scope
- 任何寫入 endpoint 必須做授權 + transaction（若牽涉多筆寫入）
- 排程/視覺化 endpoint 改動需同步更新 contracts（見 `rules/05_scheduling_rules.md`）

