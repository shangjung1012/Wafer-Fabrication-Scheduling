# 排程預覽功能介紹 (Schedule Preview Feature)

## 簡介

排程預覽功能 (`/api/schedule/preview`) 允許系統管理員 (ADMIN / SUPERADMIN) 在實際將排程寫入資料庫前，預先模擬排程引擎的執行結果。此功能會根據當前的訂單狀態、工廠產能與自訂的排程參數（如保留天數、生產天數、重排策略等），計算出一個模擬的排程配置。

透過此功能，使用者可以預先得知：

- 哪些訂單能成功排入產線 (狀態變為 `SCHEDULED`)。
- 哪些訂單因為產能不足或時間限制而排程失敗 (狀態變為 `FAILED`)。
- 模擬執行後，工廠每日剩餘產能的變化。

此預覽結果會暫存在 Redis 中（預設保留 30 分鐘），並產生一組唯一的 `previewId`，前端可藉此 ID 顯示預覽畫面，並在確認無誤後，呼叫正式執行的 API 將該預覽結果套用至資料庫。

## 系統架構與流程

預覽功能的執行流程主要分為以下三個階段，分別對應不同的模組：

### 1. API 路由層 (`app/api/schedule/preview/route.ts`)

- **權限驗證**：確認請求者是否為 `ADMIN` 或 `SUPERADMIN`。
- **參數解析**：驗證傳入的 `type`（生產類型）與 `config`（排程策略設定）。
- **呼叫核心模組**：將參數傳遞給 `previewSchedule` 進行核心模擬。
- **結果快取**：將模擬結果（包含更新後的訂單狀態、新產生的產能分配、變更的產能紀錄）連同目前的資料版本號 (`version`) 寫入 Redis，並生成 `previewId`。
- **回傳資料**：將 `previewId`、受影響的訂單清單、失敗的訂單清單回傳給前端。

### 2. 資料準備層 (`modules/schedule/core.ts` - `prepareSchedulingData`)

在執行演算法前，系統需要將目前的資料庫狀態轉換為演算法可用的記憶體狀態：

- **載入資料**：撈取符合 `type` 且狀態為 `PENDING`、`SCHEDULED`、`IN_PRODUCTION` 的訂單，以及對應的工廠與每日產能。
- **產能還原 (Capacity Reset)**：若使用的重排策略**不是** `GAP_FILLING`（例如 `GLOBAL_OPTIMIZE` 或 `PRIORITY_RETAIN`），系統會將**可變動 (Mutable)** 訂單目前已佔用的 `SCHEDULED` 產能釋放回記憶體中的產能池。
- **不可變動 (Immutable) 訂單保護**：狀態為 `IN_PRODUCTION`、`COMPLETED`，或標記為 `isFixed = true` 的訂單，其佔用的產能**不會**被釋放，以確保這些訂單的排程絕對不會在重排過程中被更動。

### 3. 排程演算法層 (`modules/schedule/strategy.ts` - `greedyBestFitStrategy`)

這是排程引擎的大腦，負責執行 Greedy Best-Fit 演算法：

- **分離訂單**：將訂單分為不可變動 (`immutableOrders`) 與可變動 (`mutableOrders`) 兩群。
- **預先扣除產能 (Pre-allocation)**：將 `immutableOrders` 的現有產能需求從產能池中預先扣除，並直接將這些訂單放入完成清單 (`processedOrders`)。
- **排序 (Sorting)**：根據優先級對 `mutableOrders` 進行排序。排序權重依序為：
  1. `isPrioritized = true` 的訂單。
  2. 若採用 `PRIORITY_RETAIN` 策略，原先就是 `SCHEDULED` 的訂單。
  3. 交期 (dueDate) 越早越優先。
  4. 數量 (quantity) 越多越優先。
  5. 建立時間 (createdAt) 越早越優先。
- **分配產能 (Allocation)**：逐一處理排序後的訂單，在可允許的生產區間（扣除 `frozenDays` 與交期前的 `bufferDays`）內尋找剩餘產能。
  - **Splittable**：允許訂單拆分在不同天或不同工廠生產，每日優先填滿剩餘產能最大的工廠 (Best-Fit)。
  - **Non-splittable**：必須找到單一工廠在單一天內能完全容納該訂單數量的產能區塊。
- **成功與失敗判定 (Rollback Ledger)**：
  - 如果訂單的剩餘需求數量能被降至 0，則排程成功，訂單狀態變為 `SCHEDULED`。
  - 如果分配結束後仍有剩餘數量，則判定為排程失敗。系統會透過 Mutation Ledger 撤銷該訂單在本次模擬中佔用的所有產能，並將該訂單狀態設為 `FAILED`。

## 核心排程設定 (Scheduling Config)

呼叫 API 時可傳入以下設定來微調演算法行為：

- `startDate`: 允許排程的最早日期。
- `endDate`: 允許排程的最晚日期。
- `frozenDays`: 凍結天數。從 `startDate` 起算，幾天內不允許排入新訂單（保留給備料等前置作業）。
- `productionDays`: 生產所需天數（預設 1）。
- `bufferDays`: 緩衝天數。訂單最晚必須在 `dueDate` 前幾天生產完畢。
- `reschedulePolicy`: 重排策略。
  - `GAP_FILLING`: 僅針對未排程的訂單填補空隙，不動既有排程。
  - `GLOBAL_OPTIMIZE`: 打散所有可變動的 `SCHEDULED` 訂單，重新進行全局最佳化分配。
  - `PRIORITY_RETAIN`: 類似全局最佳化，但會在排序階段給予原先已 `SCHEDULED` 的訂單優先權，盡量確保它們不會因為新訂單的加入而被擠掉。
- `splittable`: 訂單是否允許跨天或跨廠拆分生產。
- `algorithm`: 演算法選擇（目前固定為 `GREEDY_BEST_FIT`）。

## Redis 版本控制與併發安全 (Concurrency Safety)

在多使用者環境下，排程系統必須防止「Dirty Read」與「覆寫」。此功能透過 Redis 的版本控制機制來確保資料的一致性：

1. **紀錄版本號**：當 `/api/schedule/preview` 執行時，系統會從 Redis 讀取當前該生產類型 (Type) 的 `scheduleVersion`，並將此版本號隨預覽結果一併儲存在 Redis 的快取中。
2. **觸發版本更新**：任何會影響排程結果的操作（例如：新增訂單、修改訂單狀態、變更訂單數量或交期、直接修改產能等），都會在寫入資料庫時，同步將 Redis 中的 `scheduleVersion` 遞增。
3. **執行時校驗 (OCC - Optimistic Concurrency Control)**：當使用者確認預覽無誤，呼叫 `/api/schedule/run` 正式套用排程時，系統會比對該 `previewId` 內紀錄的 `version` 與當下 Redis 中最新的 `scheduleVersion`。
   - 若兩者**相符**：代表從預覽到套用這段期間，資料庫沒有發生任何影響排程的變更，允許寫入。
   - 若兩者**不符**：代表資料庫已被其他操作修改（例如有新訂單插入），先前的預覽結果已失效。系統會拒絕寫入，並提示使用者重新產生預覽。

## FAILED 狀態的意義

當訂單無法在指定的交期與條件內找到足夠產能時，預覽結果會將其標記為 `FAILED`。
這是一個需要人工介入的狀態。代表系統管理員可能需要：

1. 與業務或客戶協調，延後該訂單的 `dueDate`。
2. 開啟額外產能。
3. 透過 CRUD API 手動將該訂單設回 `PENDING` 或 `SCHEDULED`，以便在下一次執行排程時重新納入考量。
   排程引擎**不會**主動抓取狀態為 `FAILED` 的訂單進行重新排程。
