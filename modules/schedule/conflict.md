# Scheduling Conflict — 實作紀錄

本文件記錄排程衝突偵測與通知功能在**新架構**（strategy.ts / core.ts / preview.ts / run.ts）下的實作細節，包含偵測位置、回傳路徑、寄信流程與 UI 呈現。

> 衝突的概念性定義與整體排程架構請見 [`README.md`](./README.md)；具體可重現的測試案例請見 [`conflict_testcase.md`](./conflict_testcase.md)。

---

## 衝突定義

當以下三個條件**同時成立**時，排程衝突發生：

1. 某張訂單的交期視窗（`windowStart` 到 `windowEnd`）內，同生產類型的**所有工廠均無可用產能**。
2. 佔用該產能的訂單本身已排在各自的 `dueDate`，**無法往後移動**（再移會違反交期）。
3. 佔用該產能的訂單**無法調配至其他工廠**（其他工廠在相同時段同樣已滿載）。

排程引擎按優先序處理訂單（`isPrioritized` → 若 `reschedulePolicy = PRIORITY_RETAIN` 則對既有 SCHEDULED 加分 → `dueDate ASC` → `quantity DESC` → `createdAt ASC`）。當某張訂單 rollback 後仍無法被排入，代表未來無論再跑多少次排程結果都一樣 — 這就是「真衝突」，而不是「暫時等待」。

> 注意：`reschedulePolicy` 也會影響是否會出現衝突。`GAP_FILLING` 不釋放既有 SCHEDULED 容量，因此新訂單較容易因「空隙不夠大」而 FAILED；`GLOBAL_OPTIMIZE` / `PRIORITY_RETAIN` 會釋放容量重排，可能讓原本看起來衝突的訂單被排進去（也可能反而擠掉別張）。詳見 [`README.md`](./README.md) §3。

---

## 偵測位置：`modules/schedule/strategy.ts`

衝突偵測**完全位於 `strategy.ts` 的 greedy strategy rollback 分支內**，而不是在 `core.ts`、`run.ts` 或已被刪除的舊 `engine.ts`。

### 流程

1. Greedy strategy 對每張 mutable order 嘗試在 `[windowStart, windowEnd]` 內配置容量。
2. 若整個視窗仍 `remainingQty > 0`：
   - 反向遍歷 `rollbackLedger`，把扣除的容量加回、刪除動態建立的虛擬產能。
   - 捨棄該訂單的所有 virtual assignments。
   - **將該訂單在 `processedOrders` 中的 status 設為 `OrderStatus.FAILED`**。
3. `FAILED` 就是這次衝突的訊號 — 它會隨 `StrategyResult.processedOrders` 一起回傳。

### 為什麼用 `FAILED` 而不是獨立的 `conflictOrderIds` 欄位

新架構將衝突狀態收斂進 `OrderStatus` enum，好處：

- preview / run 共用同一份 `StrategyResult`，下游（包含 preview Redis 快取與 apply 寫入 DB）無需特別處理「conflict 子集合」。
- 衝突訂單的母單 status 一致設為 `FAILED`，DB 與 in-memory 模型統一。
- 排程引擎**不會**自動重抓 `FAILED` 訂單；需要人工介入（改 dueDate、改數量、或手動改回 PENDING/APPROVED）才會在下次排程被納入。

---

## 回傳路徑：`/api/schedule/preview`

衝突資訊**透過 preview 回傳，而非 run**。設計理由是讓管理員在實際寫入 DB 前就先看到衝突清單，並由前端自行決定要不要寄信。

### preview route 內的處理

```ts
const strategyResult = await previewSchedule(type, config, currentDate);

// 衝突偵測：strategyResult.processedOrders 內 status === FAILED 的就是
const failedOrderIds = newSchedule
  .filter((o) => o.status === OrderStatus.FAILED)
  .map((o) => o.id);

const conflictWarnings: string[] = [];
if (failedOrderIds.length > 0) {
  conflictWarnings.push(
    `There was not enough capacity to schedule ${failedOrderIds.length} orders.`,
  );
}
```

### Response body 結構

```json
{
  "previewId": "uuid-...",
  "data": {
    "newSchedule": [ /* hydrated orders with merged newAssignments */ ],
    "affectedOrders": ["order-1", "order-2", ...],
    "failedOrderIds": ["order-X"],
    "conflictWarnings": ["There was not enough capacity to schedule 1 orders."]
  }
}
```

### Hydration（給寄信清單用）

前端拿到 `failedOrderIds` 後，可進一步把每張衝突訂單 hydrate 成 conflict order payload，欄位包括：

- 訂單本身：`id`、`name`、`quantity`、`dueDate`
- **申請人（sales）**：`applicantEmail`、`applicantUsername`
- **管理員（負責該生產類型的 admin）**：`adminEmail`、`adminUsername`

這些是 `/api/schedule/notify` 預期的 payload schema（見下節）。是否要 hydrate 由 UI 決定 — 不寄信就不必撈 email。

---

## 寄信流程：`/api/schedule/notify`（手動觸發）

**`/api/schedule/run` 不會自動寄信**；`/api/schedule/apply` 也不會。寄信完全由 UI 主動呼叫 `/api/schedule/notify` 觸發。

### 設計理由

- 自動 cron 每 10 分鐘跑一次排程，若每次都自動寄信會造成同一張衝突訂單反覆騷擾收件人。
- 把「衝突偵測」與「實際通知」解耦，讓管理員審視衝突 banner 後再決定是否寄信。
- preview 提供「dry-run + 一份衝突清單」，run 則純粹推進排程結果，職責清晰。

### Request payload

```ts
POST /api/schedule/notify
{
  orders: [
    {
      id: "order-X",
      name: "Wafer-CF4-Base",
      quantity: 30,
      dueDate: "2026-05-17",
      applicantEmail: "sales-a@example.com",
      applicantUsername: "sales-A",
      adminEmail: "admin-a1@example.com",
      adminUsername: "admin-A1"
    },
    ...
  ]
}
```

### Server 端行為

- 限 SUPERADMIN / ADMIN 呼叫。
- 對每張訂單，分別建立給 applicant 與 admin 的 email job（使用 `kickOutTemplate`）。
- 以 `Promise.allSettled` 平行發送，個別失敗只記錄 `failed` 清單，不阻斷其他寄送。
- 回傳 `{ sent: string[], failed: string[] }`。

---

## UI：衝突 Banner

> 資料來源由「`runSchedule` 回傳值」改為「`/api/schedule/preview` 回傳值」。

### 流程

1. 管理員在 dashboard 點「預覽排程」→ 前端 POST `/api/schedule/preview`。
2. 拿到 response 後檢查 `data.failedOrderIds`：
   - 為空 → 顯示「無衝突，可套用」。
   - 非空 → 顯示紅色衝突 banner，列出每張衝突訂單（名稱、quantity、dueDate）。
3. Banner 上提供兩個動作：
   - **通知相關人員**：UI hydrate 出 conflict order payload，POST `/api/schedule/notify`。
   - **關閉**：可手動關閉 banner。
4. 管理員可選擇調整訂單（改 dueDate / 數量 / `isPrioritized`）後重新預覽，或在接受衝突的情況下 POST `/api/schedule/apply` 套用。

### Banner 內容示意

```
⚠ 排程衝突  以下訂單因交期視窗內產能已滿，無法完成排程：
Wafer-CF4-Base（qty 30，due 2026-05-17）、...                          [通知] [✕]
```

---

## 衝突 vs. 一般排程失敗的釐清

| 情況                                                        | 狀態結果 | 處理方式                                                           |
| :---------------------------------------------------------- | :------- | :----------------------------------------------------------------- |
| Mutable 訂單 rollback（`remainingQty > 0`）                 | `FAILED` | preview 把它列入 `failedOrderIds`，banner 顯示，可選擇性手動寄信。 |
| 訂單目前沒被排入但策略沒處理它（例如 PENDING 等待 approve） | 原狀     | 不會出現在 `failedOrderIds`。下次條件滿足再納入。                  |
| `isFixed` 訂單                                              | 不會處理 | 永遠 immutable，不參與排序、不會被搬動，更不會被標記為 FAILED。    |
| 訂單已 IN_PRODUCTION / COMPLETED                            | 不會處理 | 同上，視為 immutable，容量已預先扣除。                             |

> 排程引擎**不會**主動重抓 `FAILED` 訂單。管理員需透過 CRUD 改 dueDate / 數量、或把訂單狀態手動改回 PENDING / APPROVED，才會在下次排程被納入。

---

## 觸發路徑對照表

| 路徑                         | 跑策略 | 寫 DB | 偵測衝突 | 自動寄信 |
| :--------------------------- | :----: | :---: | :------: | :------: |
| `POST /api/schedule/preview` |   ✓    |   ✗   |    ✓     |    ✗     |
| `POST /api/schedule/apply`   |  ✗\*   |   ✓   |    ✗     |    ✗     |
| `POST /api/schedule/run`     |   ✓    |   ✓   |  ✓\*\*   |    ✗     |
| `POST /api/schedule/notify`  |   ✗    |   ✗   |    ✗     |    ✓     |

\* apply 直接套用先前 preview 的 `StrategyResult`，不重跑策略。
\*\* run 內部仍會產出 `FAILED` 狀態並寫入 DB，但 response 不顯式列出衝突清單；要拿衝突資訊應走 preview。

---

## 測試場景（Case 4 seed）

詳細步驟見 [`conflict_testcase.md`](./conflict_testcase.md)。

**Quick start：**

1. `pnpm db:seed`
2. `admin-A1` 觸發排程（建議走 `/api/schedule/preview`）→ `Wafer-CF4-Base`（qty=80）排入 factory-A1 May 17。
3. `sales-A` 新增訂單：type=A, qty=30, dueDate=2026-05-17。
4. `admin-A1` 核准後再次 preview。
5. preview response 中 `data.failedOrderIds` 包含新訂單 ID；UI banner 出現紅色提示。
6. 管理員從 banner 點「通知」→ 前端 POST `/api/schedule/notify`，sales-A 與 admin-A1/A2/A3 收到信。

---

## 涉及的檔案

| 檔案                                     | 變更                                                                                       |
| :--------------------------------------- | :----------------------------------------------------------------------------------------- |
| `modules/schedule/strategy.ts`           | rollback 分支內把訂單 status 設為 `OrderStatus.FAILED`，作為衝突訊號                       |
| `modules/schedule/preview.ts`            | 純跑策略、不寫 DB；產出 `StrategyResult` 給 preview route                                  |
| `modules/schedule/core.ts`               | `prepareSchedulingData` 處理 isFixed / IN_PRODUCTION / COMPLETED 的 immutable 保護         |
| `app/api/schedule/preview/route.ts`      | 過濾出 `failedOrderIds`、組 `conflictWarnings`、產生 `previewId` 並寫 Redis                |
| `app/api/schedule/apply/route.ts`        | 取出 preview payload、做 OCC 版本檢查、呼叫 `applyScheduleTransaction` 寫入 DB             |
| `app/api/schedule/notify/route.ts`       | 手動寄信端點，接受 hydrated conflict orders payload，用 `kickOutTemplate` 寄給 sales/admin |
| `app/api/schedule/run/route.ts`          | 一氣呵成排程，內部會產生 FAILED 但不主動寄信                                               |
| `app/(dashboard)/visualization/page.tsx` | 衝突 banner 改由 preview response 驅動，提供「通知」按鈕呼叫 `/api/schedule/notify`        |
