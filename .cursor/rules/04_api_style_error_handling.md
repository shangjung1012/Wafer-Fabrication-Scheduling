# Rule: API style & error handling

## Spec alignment

- 路由與資料結構以 `api_spec.yml` 為準
- 新增/修改 endpoint 必須同步更新 `api_spec.yml`

## Input validation (must)

- path params / query / body 全部要驗證（建議 `zod`）
- 驗證失敗回 `400`

## Error format (recommended)

錯誤回應統一：

```json
{ "code": "FORBIDDEN", "message": "…", "details": {} }
```

狀態碼規範：
- `401` unauthenticated
- `403` forbidden
- `404` not found
- `409` conflict（排程版本衝突、排程衝突）

## Logging (recommended)

- server-side log 需包含 requestId、userId（若已登入）、endpoint
- 不記錄 token/secret

