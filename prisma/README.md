# Prisma Schema 架構說明

> 本文件說明 `schema.prisma` 的設計決策、各 model 的職責與相互關係。

---

## 目錄結構

```text
prisma/
├── schema.prisma      # 資料模型與 enum 定義
├── migrations/        # 自動生成的遷移記錄
├── seed.mjs           # 本地開發用的 seed 資料
└── README.md          # 本文件
```

---

## 組織架構與角色

系統有三種 **productionType**（A/B/C）。每種 type 底下有三間工廠（`Factory`）以及一個 SUPERADMIN。

```
productionType A
├── Factory A1  (adminId → Admin User)
│   └── Sales User 1, 2, ...
├── Factory A2
├── Factory A3
└── SUPERADMIN（管理 A 下全部工廠與 Admin）
```

角色對應 `UserRole` enum：

| 角色 | 說明 |
|---|---|
| `SUPERADMIN` | 管理同 type 下所有工廠與 Admin；擁有 Admin 全部權限 |
| `ADMIN` | 管理單一工廠的訂單、排程、派工、Sales |
| `SALES` | 建立訂單（PENDING）；提交修改申請；只能看受限訂單 |

scope 來源：
- `User.group`：建議存 `type:A`，用來推導 type scope
- `Factory.adminId`：推導 factory scope（哪些工廠由誰管）
- `OrderPermission`：SALES 細粒度可見訂單清單

---

## Model 說明

### `User`

| 欄位 | 說明 |
|---|---|
| `role` | SUPERADMIN / ADMIN / SALES |
| `group` | 建議存 `type:A`（type scope 來源） |
| `password` | 可選（未實作 login 時為 null） |

Relations：
- `managedFactories`：ADMIN/SUPERADMIN 管理的工廠（透過 `Factory.adminId` 反推）
- `orders`：此 user 提出的訂單
- `permissions`：細粒度訂單可見清單（`OrderPermission`）
- `requests`：此 user 提出的修改申請

---

### `Factory`

| 欄位 | 說明 |
|---|---|
| `productionType` | A / B / C（決定此工廠屬於哪個 type） |
| `adminId` | 管理此工廠的 Admin user id（nullable） |
| `maxCapacity` | 工廠日產能上限（預設 10000） |
| `status` | ACTIVE / INACTIVE |

Relations：
- `dailyCapacities`：每日產能快照（`DailyCapacity`）
- `assignments`：分配到此工廠的派工單（`OrderAssignment`）

---

### `DailyCapacity`

每間工廠每一天的產能快照，**一筆 = 一間工廠的一天**。

| 欄位 | 說明 |
|---|---|
| `factoryId` | 所屬工廠 |
| `date` | 哪一天（建議存 UTC 00:00:00 對齊） |
| `maxAmount` | 該天產能上限（通常帶入 `Factory.maxCapacity`） |
| `curAmount` | 該天剩餘產能（排程時扣除） |

約束：
- `@@unique([factoryId, date])`：同一工廠同一天只有一筆
- 資料只按需生成（排程時需要哪天就建哪天），避免預建過多未來日期

---

### `Order`

| 欄位 | 說明 |
|---|---|
| `status` | 見狀態機 |
| `dueDate` | 客戶要求交期 |
| `productionDate` | 實際排定生產日（SCHEDULED 後才填）|
| `factoryId` | SUPERADMIN 分配後填入 |
| `applicantId` | 最初提出者（SALES） |
| `lastModifiedById` | 最後修改者（任何 write 都應更新） |
| `type` | 對應 `productionType`（A/B/C） |

#### 狀態機

```
PENDING ──── Admin 核准 ──────────► APPROVED
                                        │
                                  排程確認生效
                                        │
                                        ▼
                                   SCHEDULED
                                        │
                                   開始生產
                                        │
                                        ▼
                                  IN_PRODUCTION
                                        │
                                   生產完成
                                        │
                                        ▼
                                   COMPLETED（不可回退）

PENDING / APPROVED / SCHEDULED / IN_PRODUCTION ──► CANCELLED（不可回退）
```

| 狀態 | 意義 | Sales 能改? | Admin 能改? |
|---|---|---|---|
| `PENDING` | Sales 剛建立 | 可直接改（自己的） | 可 |
| `APPROVED` | Admin 核准，鎖定 | 只能送 `OrderRequest` | 可 |
| `SCHEDULED` | 已排程 | 只能送 `OrderRequest` | 可（需重排） |
| `IN_PRODUCTION` | 生產中 | 只能送 `OrderRequest` | 可（需重排） |
| `COMPLETED` | 完成 | 不可 | 不可 |
| `CANCELLED` | 取消 | 不可 | 不可 |

---

### `OrderAssignment`（派工單，支援拆單）

一筆 `Order` 可被拆成多筆 `OrderAssignment`，分配到不同工廠、不同日期生產。

| 欄位 | 說明 |
|---|---|
| `orderId` | 來自哪筆訂單 |
| `factoryId` | 分配到哪間工廠 |
| `productionDate` | 排在哪一天生產 |
| `assignedQuantity` | 這筆派工單的數量 |

排程時需同步扣減對應的 `DailyCapacity.curAmount`（建議以 transaction 實作）。

---

### `OrderPermission`

SALES 細粒度訂單可見清單。`(userId, orderId)` 聯合唯一。

---

### `OrderRequest`

SALES 對「已鎖定訂單」提出的修改申請。由 `payload: Json?` 帶入希望修改的欄位內容，交由 Admin/Superadmin 審核後執行。

---

## 關係圖（主要 relations）

```
User ─────────────────────────────────────────────────────────────────┐
 │  managedFactories              applicant / lastModifiedBy / requests│
 │                                                                      │
Factory ──── DailyCapacity                        Order ──── OrderRequest
 │                                                  │
 └──────── OrderAssignment ─────────────────────────┘
               (orderId + factoryId + date + qty)

User ─── OrderPermission ─── Order
```

---

## Migration 與 Seed

```bash
# 本地開發：建 migration + 套用
pnpm db:migrate

# 正式/CI 部署（只套用，不建新 migration）
pnpm db:deploy

# 產生 Prisma client
pnpm db:generate

# 建立預設 seed 資料（superadmin / admin / sales + 3 factories）
pnpm db:seed
```

Seed 預建的資料（stable id，可重複執行）：

| id | name | role | group |
|---|---|---|---|
| `seed-superadmin` | Seed SuperAdmin | SUPERADMIN | type:A |
| `seed-admin-a1` | Seed Admin A1 | ADMIN | type:A |
| `seed-sales-a1` | Seed Sales A1 | SALES | type:A |

工廠：`seed-factory-a1`（adminId = seed-admin-a1）、`seed-factory-a2`、`seed-factory-a3`

---

## 設計決策備忘

- **`DailyCapacity` 按需生成**：不預建所有未來日期；排程模組在需要某天時才 upsert。
- **`Factory.maxCapacity` 是預設值**：每天的 `DailyCapacity.maxAmount` 以此為初始值，但可個別覆寫（例如特殊假日降產）。
- **`OrderAssignment` 支援拆單**：同一筆 `Order` 可跨工廠、跨日期分批生產；`assignedQuantity` 總和應等於 `Order.quantity`（由 application layer 保證）。
- **`generator client` 輸出到 `lib/generated/prisma`**：import 時用 `@/lib/generated/prisma`（alias `@` 對應根目錄）。
