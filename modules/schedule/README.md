# Scheduling Engine (排程引擎)

本模組負責系統核心的生產排程邏輯，目前預設採用 **Greedy Best-Fit (貪婪最佳擬合)** 演算法，並具備高度的擴展性。

---

## 1. 模組架構設計 (Architecture)

本模組遵循關注點分離原則（Separation of Concerns），把「策略演算法」、「資料準備與寫入」、「兩段式 preview / apply 流程」與「執行入口」拆成多個檔案：

| 檔案                    | 職責                                                                                                                    |
| :---------------------- | :---------------------------------------------------------------------------------------------------------------------- |
| `strategy.ts`           | 純函式核心 — Greedy Best-Fit 演算法 + Mutation Ledger Rollback + **衝突偵測**（產出 `OrderStatus.FAILED`）。不依賴 DB。 |
| `config.ts`             | `SchedulingConfig` 型別定義：`reschedulePolicy` / `frozenDays` / `bufferDays` / `productionDays` / `splittable` 等。    |
| `core.ts`               | 「策略執行前」資料準備（`prepareSchedulingData`）與「策略執行後」DB Transaction 寫入（`applyScheduleTransaction`）。    |
| `preview.ts`            | 一段式 **dry-run**：只跑策略、不寫 DB。產出 `StrategyResult` 供 preview route 序列化與快取。                            |
| `run.ts`                | 一氣呵成：跑策略 + 直接寫 DB。給 `/api/schedule/run`（自動 cron / 管理員手動執行）使用。                                |
| `infra/db/*-repository` | 資料層：訂單、工廠、產能、Assignment 等 CRUD。被 `core.ts` 呼叫，保持策略層純粹。                                       |

> 舊版的 `engine.ts` 已被拆解並刪除：演算法移至 `strategy.ts`，DB 寫入移至 `core.ts`，執行入口拆成 `run.ts` 與 `preview.ts`。

---

## 2. 核心時間常數與設定 (Scheduling Config)

排程行為由 `SchedulingConfig` 完整決定，呼叫 preview / run API 時可逐項覆蓋：

| 欄位               | 預設值            | 說明                                                                                                |
| :----------------- | :---------------- | :-------------------------------------------------------------------------------------------------- |
| `startDate`        | `Today + 1`       | 排程視窗起始日（不含當日，因每日 0:00 狀態自動轉換，當日視為 IN_PRODUCTION）。                      |
| `endDate`          | _未設定 (∞)_      | 排程視窗結束日；若設定，所有訂單 windowEnd 都會被 clamp 至此日。                                    |
| `frozenDays`       | `0`               | **凍結期**：`startDate` 起算的前 N 天不排新單，保留給備料、前置作業。                               |
| `productionDays`   | `1`               | **生產週期**：產品從 IN_PRODUCTION 到 COMPLETED 所需天數。                                          |
| `bufferDays`       | `0`               | **出貨緩衝**：完成生產後至 dueDate 之間需保留的物流／品檢天數。                                     |
| `splittable`       | `true`            | 全域旗標：是否允許單張訂單**跨日 / 跨廠拆分**。`false` 時演算法必須在某個工廠的某一天找到整包容量。 |
| `algorithm`        | `GREEDY_BEST_FIT` | 演算法選擇（預留擴充點）。                                                                          |
| `reschedulePolicy` | `GAP_FILLING`     | 重排策略，詳見 §3。                                                                                 |
| `targetOrderIds`   | _未設定_          | 可選；若傳入則只排這些訂單，其餘維持不動（用於增量排程或單筆修正）。                                |

訂單視窗計算（在 `strategy.ts`）：

- `windowStart = config.startDate + frozenDays`
- `windowEnd   = order.dueDate − bufferDays − productionDays`（若超過 `config.endDate` 則 clamp）

---

## 3. 重排策略 (`reschedulePolicy`)

三種策略決定「既有 SCHEDULED 訂單在重排時是否能被搬動」：

| 策略              | 釋放既有 SCHEDULED 容量？ | 排序行為                                                       | 使用情境                                                          |
| :---------------- | :------------------------ | :------------------------------------------------------------- | :---------------------------------------------------------------- |
| `GAP_FILLING`     | **不釋放**                | 既有排程完全保留，只把新訂單塞入剩餘空隙。                     | 高頻自動 cron、想要排程結果穩定、不希望既有訂單因新單到來而漂移。 |
| `GLOBAL_OPTIMIZE` | **全部釋放**              | 純按優先序（dueDate → quantity → createdAt）重排全部可變訂單。 | 大幅度重整（例如新增工廠、產能異動），追求全局最優解。            |
| `PRIORITY_RETAIN` | **全部釋放**              | 排序時對原本就是 SCHEDULED 的訂單給予優先權，盡量留在原位。    | 想要全局最佳化、但又不希望既有訂單大幅漂移時的折衷。              |

**不變的鐵則**：無論策略為何，下列訂單**永遠不會被搬動**（在 `core.ts` 與 `strategy.ts` 都會檢查）：

- `order.isFixed === true`
- `order.status === IN_PRODUCTION`
- `order.status === COMPLETED`

它們的 SCHEDULED 容量**不會**釋放回產能池，並會被當作 immutable orders 預先扣除產能。

---

## 4. 訂單旗標 (`isFixed` / `isPrioritized`)

兩個訂單層級旗標直接影響策略行為，由 Sales/Admin 在訂單建立或審核時設定：

| 旗標                   | 行為                                                                                                                                       |
| :--------------------- | :----------------------------------------------------------------------------------------------------------------------------------------- |
| `isFixed = true`       | **鎖定不可重排**。視同 IN_PRODUCTION 一般處理：容量不釋放、不被搬動、永遠歸類為 immutable order。即使是 `GLOBAL_OPTIMIZE` 也不會動它。     |
| `isPrioritized = true` | **優先排程**。在 mutable orders 的排序最前面（高於 PRIORITY_RETAIN 對 SCHEDULED 的偏好，也高於 dueDate）。常用於急單、VIP 客戶、戰略訂單。 |

排序權重總結（適用於 mutable orders）：

1. `isPrioritized = true` 排最前
2. （僅 `PRIORITY_RETAIN`）原本 SCHEDULED 的排第二優先
3. `dueDate` 升序
4. `quantity` 降序
5. `createdAt` 升序

---

## 5. 演算法詳解 (Greedy Best-Fit)

### A. 資料選取與預處理（`core.ts → prepareSchedulingData`）

1. **訂單過濾**：撈取狀態為 `PENDING` / `SCHEDULED` / `IN_PRODUCTION` 且類型匹配的母單；preview 預設只納入 `config.targetOrderIds` 指定的 PENDING 訂單，run / auto-scheduler 會納入該 type 的所有 PENDING 訂單。
2. **產能載入**：撈取對應工廠與該類型的 `DailyCapacity`，存為 in-memory `capacities` 陣列。
3. **In-Memory Capacity Reset**：
   - 僅當 `reschedulePolicy ≠ GAP_FILLING`，才把 mutable 訂單（即非 `isFixed` 且非 IN_PRODUCTION/COMPLETED）目前 SCHEDULED 子單佔用的容量加回 `curCapacity`。
   - `GAP_FILLING` 不做這步，因此既有排程完全不被擾動。

### B. 策略執行（`strategy.ts → greedyBestFitStrategy.execute`）

1. 將訂單分為 `immutableOrders`（isFixed / IN_PRODUCTION / COMPLETED）與 `mutableOrders`。
2. **預先扣除**：把 immutable orders 的現有 assignments 從 capacity map 扣掉（若該 (factory, date) 還沒有產能紀錄，動態用 `factory.maxCapacity` 建立）。
3. 對 `mutableOrders` 按 §4 排序。
4. 逐張訂單在 `[windowStart, windowEnd]` 內分配：
   - **`splittable = true`**：day-by-day, factory-by-factory；每日先排序產能大的工廠（Best-Fit）。
   - **`splittable = false`**：尋找單一 (factory, date) 能完整容納 `remainingQty` 的方塊。
5. **動態產能生成**：若某 (factory, date) 尚無 DB 紀錄，按 `factory.maxCapacity` 動態建立並記錄於 `rollbackLedger.wasCreated = true`。

### C. Mutation Ledger Rollback

為避免 O(N × M) 的快照拷貝，採用輕量 **Mutation Ledger**：

- 每張訂單處理時都會記錄這次的容量扣除與動態建立紀錄。
- 若整個視窗仍無法滿足（`remainingQty > 0`）：
  - 反向遍歷 ledger 把扣除的產能加回、刪除動態建立的虛擬產能。
  - 捨棄該訂單的所有虛擬 assignments。
  - **將該訂單在 `processedOrders` 中的 status 設為 `FAILED`**（這就是衝突訊號，見 §7）。

### D. Strategy 輸出

`StrategyResult` 結構（純記憶體物件，可被 JSON 序列化存到 Redis 給 preview 用）：

```ts
{
  processedOrders: ProcessedSchedulingOrder[]; // 每張訂單最終狀態（SCHEDULED / FAILED / 維持原狀）
  newAssignments: OrderAssignmentDraft[];      // 待寫入的新 assignment
  updatedCapacities: ExistingCapacityDraft[];  // 待 UPDATE 的既有產能
  newCapacities: CapacityDraft[];              // 待 INSERT 的新產能
}
```

---

## 6. 兩段式 Preview / Apply 流程

新架構提供 **dry-run** 預覽機制，讓管理員在套用前先看結果：

```
┌─────────────────────────┐         ┌──────────────────────────┐
│ POST /api/schedule/preview │  ──▶  │ POST /api/schedule/apply │
│  (跑策略 → 暫存 Redis)     │       │  (從 Redis 取出 → 寫 DB)  │
└─────────────────────────┘         └──────────────────────────┘
         │                                       ▲
         ▼                                       │
   回傳 previewId、newSchedule、               以 previewId 套用
   failedOrderIds                              並做 OCC 版本檢查
```

### A. `/api/schedule/preview`

- 呼叫 `previewSchedule()` 跑策略但**不寫 DB**。
- 產出唯一 `previewId`（UUID）。
- 將 `{ type, config, version, result }` 寫入 Redis，TTL 30 分鐘。
- `version` 是當前 type 的 `scheduleVersion`（OCC token），任何會影響排程的 DB 變動都會 increment 這個值。
- response body 結構：

```ts
{
  previewId: string,
  data: {
    newSchedule: ProcessedOrder[], // hydrated，含 newAssignments
    affectedOrders: string[],
    failedOrderIds: string[],      // 衝突訂單 ID（status === FAILED）
  }
}
```

### B. `/api/schedule/apply`

- 從 Redis 用 `previewId` 取回先前結果。
- 取得 Redis 分散式鎖 `schedule:lock:[type]`（fail-fast，409 Conflict）。
- **OCC 校驗**：比對 preview 當下的 `version` 與當下 Redis 的 `scheduleVersion`：
  - 一致 → 直接呼叫 `applyScheduleTransaction()` 寫入 DB，然後 increment version，刪除 preview。
  - 不一致 → 回 409，要求重新預覽（因為 DB 已被其他人改動，預覽結果已失效）。
- 釋放鎖。

### C. `/api/schedule/run`（一氣呵成）

- 不走 preview/apply 兩段，透過 `runScheduleWithIssues()` 跑策略 + 寫 DB 一次完成，並處理 FAILED 訂單的 issue/email side effect。
- 同樣受 `schedule:lock:[type]` Redis 分散式鎖保護。
- 兩種觸發來源：
  - **外部排程觸發**：POST `/api/schedule/run`，使用一般 auth token / cookie，且呼叫者需為 `SUPERADMIN` 或可管理該 type 的 `ADMIN`。
  - **手動**：登入的 `SUPERADMIN` / `ADMIN` 可由 Dashboard 觸發，並套用同一組 type 權限檢查。

---

## 7. 衝突偵測與通知 (Conflict Detection & Notify)

### A. 衝突定義

當以下三條件同時成立時，視為排程衝突：

1. 某張訂單的 `[windowStart, windowEnd]` 內，同類型所有工廠均無剩餘容量。
2. 佔用該容量的訂單本身已排在各自 dueDate，**無法後移**。
3. 佔用該容量的訂單**無法調配至其他工廠**（其他工廠相同時段也滿載）。

### B. 偵測位置

**衝突偵測在 `strategy.ts`，不在 `core.ts` / `run.ts`**：

- 演算法 rollback 分支執行時，會將該訂單在 `processedOrders` 的 `status` 設為 `OrderStatus.FAILED`。
- preview route 透過 `o.status === OrderStatus.FAILED` 過濾出 `failedOrderIds`。

### C. 回傳路徑（preview only）

- `/api/schedule/preview` 回傳 `data.failedOrderIds`。
- 前端拿到 ID 後可進一步 hydrate 訂單詳情（名稱、quantity、dueDate、申請人 email、admin email）以呈現衝突 banner 或寄信清單。

### D. Conflict issue 自動建立（取代手動 notify）

`apply` / `run` 寫入 DB 的 transaction 會對每筆新 FAILED order 建立 `ConflictIssue`，並回傳待寄送的 email callback。`modules/order/schedule-orchestrator.ts` 會在 HTTP route 與 cron 路徑中 fire-and-forget dispatch emails。詳見 `modules/order/conflict-issue-service.ts` 與 `modules/order/schedule-orchestrator.ts`。

---

## 8. 並發控制 (Concurrency Control)

| 機制                    | 保護對象                                     | 行為                                                                                                                                                     |
| :---------------------- | :------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schedule:lock:[type]`  | `/api/schedule/run` 與 `/api/schedule/apply` | Redis SET NX EX 300 並寫入 owner token；釋放時用 Lua compare-and-delete，避免刪到其他 replica 重新取得的鎖。已被持有時直接回 409 Conflict（fail-fast）。 |
| `scheduleVersion` (OCC) | `/api/schedule/apply`                        | 比對 preview 當下 version 與目前 version；不一致則拒絕套用、要求重新預覽。                                                                               |
| Prisma `$transaction`   | `applyScheduleTransaction`                   | 所有 DB 寫入（刪舊 assignment、更新母單、更新／新增 capacity、寫入新 assignment）原子化。                                                                |

---

## 9. 觸發機制

### A. 自動排程

兩條路徑都可以驅動引擎，目前生產環境以 in-process worker 為主：

1. **In-process node-cron worker（`scripts/cron.ts`）** — 與 Next.js 部署在同一映像，啟動後常駐：
   - `0 */2 * * *` → `runAutoScheduler`（每兩小時整點觸發）
   - `0 0 * * *` → `runDailyExecution`（每日 00:00，呼叫 `advanceOrderStatuses` 推進訂單／派工單狀態）
2. **外部排程觸發（保留路徑）** — POST `/api/schedule/run`，使用一般 auth token / cookie，且呼叫者需為 `SUPERADMIN` 或可管理該 type 的 `ADMIN`。

兩條路徑都預設 `reschedulePolicy = GAP_FILLING`（in-process 來自 per-type 設定預設值），避免高頻重排把既有 SCHEDULED 訂單甩來甩去。

#### A.1 `runAutoScheduler` 行為

1. `findPendingOrderTypes(prisma)` 回傳所有有 PENDING 訂單的 type；無 pending 就直接 return。
2. `findUserByUsername(prisma, "AutoScheduler")` 取得系統使用者；找不到則直接 return（不會 fallback 到其他帳號）。`operatorId` 一律記為這位 system user。
3. 對每個 type 讀取 `AutoSchedulerConfig`。若沒有設定或 `isOperating=false`，記 log 後 skip。
4. 組 `SchedulingConfig`：`startDate = getTime() 的隔日 00:00`，`frozenDays / productionDays / bufferDays / algorithm / splittable` 直接套用 config row；`reschedulePolicy` 固定為 `GAP_FILLING`，避免自動排程搬動既有 SCHEDULED 訂單。
5. 呼叫 `runScheduleWithIssues({ type, config, currentDate, operatorId: systemUser.id })` —— 直接走 service/orchestrator 層，跳過 `/api/schedule/run` route，但仍會建立 FAILED 訂單的 issue 並非同步寄信。
6. 錯誤訊息含 `already running`（Redis 鎖被持有）就記 log 後跳過該 type；其他錯誤記 `console.error` 後繼續下一個 type。沒有重試與退避。

#### A.2 `AutoSchedulerConfig` 結構

每個訂單 type 一筆設定列，schema 定義於 `prisma/schema.prisma` 的 `AutoSchedulerConfig` model：

| 欄位               | 型別      | 預設值              | 意義                                                                                         |
| :----------------- | :-------- | :------------------ | :------------------------------------------------------------------------------------------- |
| `type`             | `String`  | —（unique）         | 對應 `Order.type`，每個 type 一筆設定                                                        |
| `isOperating`      | `Boolean` | `true`              | 該 type 的自動排程開關；`false` 時 cron 略過該 type                                          |
| `frozenDays`       | `Int`     | `0`                 | 直接餵給 `SchedulingConfig.frozenDays`，定義不可變動的前緣天數                               |
| `productionDays`   | `Int`     | `1`                 | 每張單最小生產天數                                                                           |
| `bufferDays`       | `Int`     | `0`                 | 完工到 dueDate 之間的緩衝                                                                    |
| `reschedulePolicy` | `String`  | `"GAP_FILLING"`     | 保留給手動/未來自動排程策略設定；目前 in-process auto-scheduler 寫入時固定使用 `GAP_FILLING` |
| `algorithm`        | `String`  | `"GREEDY_BEST_FIT"` | 目前只支援 `GREEDY_BEST_FIT`                                                                 |
| `splittable`       | `Boolean` | `true`              | 是否允許跨工廠／跨日切單，對應 `SchedulingConfig.splittable`                                 |

#### A.3 開關操作

- 讀取與更新都走 `/api/system/auto-scheduler`：
  - `GET` — 任何已登入使用者可呼叫，回傳所有 type 的 config 陣列。
  - `PATCH` — 限 `SUPERADMIN` / `ADMIN`，body 走 Zod schema 驗證（`type` 必填，其餘欄位皆 optional）。`ADMIN` 只能更新自己 production group 的 type；`SUPERADMIN` 可更新所有標準 type。`isOperating: false` 即關掉該 type 的自動排程；下一輪 cron tick 立刻生效。
- Repository 的 `updateAutoSchedulerConfig` 用 `upsert`，所以第一次設定不存在的 type 也會自動建立 row。

#### A.4 與 preview / apply 的併發互動

`runSchedule` 在內部用 `withScheduleLock(type, ...)` 取得 `schedule:lock:<type>`（`SET NX EX 300` + owner token），與 `/api/schedule/apply`、`/api/schedule/run` 共用同一支 key——cron 寫入與管理員手動寫入互斥。

- cron tick 撞到管理員正在 apply：`runSchedule` 內 `redis.set NX` 失敗，丟出 `already running`，cron 的 per-type catch 略過此 type 並記 log。
- 管理員按 apply 撞到 cron：`/api/schedule/apply` 回 409 Conflict，UI 應提示重新預覽。
- **OCC `scheduleVersion`**：cron 路徑不經過 preview 快取，但 `_applyScheduleTransaction` 一樣會更新 `scheduleVersion`。任何「在 cron tick 期間建立的 preview」會在使用者按 apply 時被 OCC 擋下，要求重新預覽。

#### A.5 與自動 issue 建立的關係

HTTP route 與 in-process cron 都會透過 `modules/order/schedule-orchestrator.ts` 呼叫排程服務。排程 transaction 會建立新的 FAILED order 對應的 `ConflictIssue`，orchestrator 會在回應/cron tick 不被阻塞的情況下非同步寄送通知 email。

### B. 管理員手動

- Dashboard「立即更新排程」按鈕走 cookie auth + RBAC（限 SUPERADMIN / ADMIN）。
- 建議搭配 preview/apply 流程：先預覽看影響，再決定是否套用。

---

## 10. 測試規範

本模組強制執行 **TDD**：

| 測試類型    | 位置                                            | 重點                                                                                      |
| :---------- | :---------------------------------------------- | :---------------------------------------------------------------------------------------- |
| Unit        | `__tests__/modules/schedule/strategy.test.ts`   | 純演算法：邊界日期、產能不足、splittable on/off、isFixed/isPrioritized、Rollback Ledger。 |
| Unit        | `__tests__/modules/schedule/core.test.ts`       | `prepareSchedulingData` 的 capacity reset 行為（含三種 reschedulePolicy）。               |
| Unit        | `__tests__/modules/schedule/preview.test.ts`    | `previewSchedule` 不寫 DB。                                                               |
| Unit        | `__tests__/modules/schedule/run.test.ts`        | `runSchedule` 串接 strategy → transaction。                                               |
| API         | `__tests__/api/schedule/preview.test.ts`        | Redis 寫入、previewId 產生、權限。                                                        |
| API         | `__tests__/api/schedule/apply.test.ts`          | OCC 版本檢查、鎖、Redis 取資料。                                                          |
| API         | `__tests__/api/schedule/route.test.ts`          | `/api/schedule/run` cron 與手動兩條路徑。                                                 |
| Integration | `__tests__/integration/schedule-engine.test.ts` | End-to-end：DB seed → run → 驗證 assignment 與 capacity。                                 |
| Integration | `__tests__/integration/redis-lock.test.ts`      | Redis 鎖在並發下的 fail-fast 行為。                                                       |
| Benchmark   | `pnpm benchmark`                                | 10,000+ 訂單下的運算效能回歸測試。                                                        |
