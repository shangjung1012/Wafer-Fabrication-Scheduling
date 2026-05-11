# Orders Test UI

開在 `http://localhost:3000/orders`，用來直接測試所有 Orders & Requests API endpoint，不需要 Postman 或 curl。

---

## 怎麼用

### 1. 登入

先到 `http://localhost:3000/login` 使用 seed 帳號登入，例如：

| Username   | 角色       | 預設密碼       |
| ---------- | ---------- | -------------- |
| `sa-A`     | SUPERADMIN | `Password123!` |
| `admin-A1` | ADMIN      | `Password123!` |
| `sales-A`  | SALES      | `Password123!` |

登入後再進 `/orders`。頁面會使用登入取得的 JWT access token 呼叫 API，並依目前帳號角色隱藏沒有權限的操作區塊。

### 2. 看哪些區塊出現

UI 只顯示該角色實際有權限的 endpoint，不會顯示沒有權的（例如選 SALES 不會看到 Delete Orders）：

| 區塊            | SALES | ADMIN | SUPERADMIN |
| --------------- | ----- | ----- | ---------- |
| List Orders     | ✓     | ✓     | ✓          |
| Get Order       | ✓     | ✓     | ✓          |
| Create Order    | ✓     | —     | —          |
| Update Order    | ✓     | ✓     | —          |
| Delete Orders   | —     | ✓     | —          |
| Import CSV      | —     | ✓     | ✓          |
| List Requests   | ✓     | ✓     | ✓          |
| Create Request  | ✓     | —     | —          |
| Update Request  | ✓     | —     | —          |
| Approve Request | —     | ✓     | ✓          |

Update Order 對 SALES 和 ADMIN 顯示的欄位也不同：SALES 沒有 Status 下拉；ADMIN 有。

### 3. 送出請求

填好欄位，點 **Send**。右側會出現 `HTTP 200`（或其他狀態碼），下方的 JSON 區塊顯示完整 response。

---

## Badge 顏色

每個區塊標題旁邊有角色 badge：

- 綠色 `SALES` — 只有 SALES 看得到
- 藍色 `ADMIN` — 只有 ADMIN 看得到
- 紫色 `SUPERADMIN` — 只有 SUPERADMIN 看得到
- 無 badge — 所有角色都看得到

---

## 各區塊欄位說明

### List Orders

- **Keyword**（選填）：用 name 或 type 模糊搜尋

### Get Order

- **Order ID**：完整的 UUID

### Create Order（SALES）

- **Name**：訂單名稱
- **Type**：生產群組，填 `A`、`B` 或 `C`（必須和你的 SALES 帳號 group 對應）
- **Due Date**：到期日（date picker）
- **Quantity**：正整數

### Update Order

- **Order ID**：要改的訂單 UUID
- **Name**（選填）：新名稱
- **Quantity**（選填）：新數量
- **Status**（ADMIN 限定，選填）：從下拉選 status，留空表示不改

> SALES 只能改自己的 PENDING 訂單；ADMIN 只能改同 group 的訂單。

### Delete Orders（ADMIN）

- **Order IDs**：逗號分隔的 UUID 列表，例如 `id1, id2, id3`
- 軟刪除，status 改成 `CANCELLED`，不是真正刪掉

### Import CSV（ADMIN / SUPERADMIN）

- 選 `.csv` 檔案，點 Send
- CSV 格式：`name,type,dueDate,quantity`
- 回傳：`{ successCount, errorList }`

範例 CSV：

```csv
name,type,dueDate,quantity
TestOrderA,A,2026-12-01,100
TestOrderB,A,2026-12-15,200
```

### List Requests

- 無欄位，直接 Send

### Create Request（SALES）

- **Order ID**：要申請修改的訂單 UUID
- **Message**：說明原因
- **Payload**：JSON 格式，填想改的欄位，例如 `{"quantity": 2000}`

### Update Request（SALES）

- **Request ID**：要修改的申請 UUID
- **New Message**：更新的說明文字

### Approve Request（ADMIN / SUPERADMIN）

- **Request ID**：要核准的申請 UUID
- 核准後 payload 會直接套用到對應訂單

---

## Token 儲存

登入 token 由 `/login` 寫入 `localStorage["auth_access_token"]`、`localStorage["auth_refresh_token"]` 與 `localStorage["auth_user"]`。登出時會清除目前 token 與舊版測試 token key。
