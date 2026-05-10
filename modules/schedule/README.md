# Scheduling Engine (排程引擎)

本模組負責系統核心的生產排程邏輯，目前預設採用 **Greedy Best-Fit (貪婪最佳擬合)** 演算法，並具備高度的擴展性。

---

## 1. 模組架構設計 (Architecture)

本模組遵循關注點分離原則（Separation of Concerns），將「資料存取」、「業務演算法」與「執行指揮」拆分：

- **Strategy (策略層 - `strategy.ts`)**:
  - 純粹的數學與邏輯運算，不依賴資料庫（Prisma）。
  - 採用策略模式，未來可輕鬆**替換為不同的演算法**（如優先權排程、最小碎片排程等）。
- **Engine (執行引擎 - `engine.ts`)**:
  - 負責與 Repository 溝通獲取資料。
  - 處理資料預處理（如記憶體狀態重置）。
  - 驅動 Strategy 並管理資料庫原子性寫入（Transaction）。
- **Repository (資料層 - `infra/db/`)**:
  - 封裝標準的 CRUD 語法，供 Engine 調用，保持 Engine 邏輯純粹。

---

## 2. 核心時間常數 (Scheduling Constants)

排程視窗由以下三個核心變數決定，均可根據生產需求調整：

| 常數             | 預設值 | 說明                                                                                             |
| :--------------- | :----- | :----------------------------------------------------------------------------------------------- |
| `frozenDays`     | `0`    | **凍結期**：訂單進入 `IN_PRODUCTION` 前鎖定不可變動的天數。(暫時設定不凍結)                      |
| `productionDays` | `1`    | **生產週期**：產品從 `IN_PRODUCTION` 到 `COMPLETED` 所需天數。(暫時設定花一天製造)               |
| `bufferDays`     | `0`    | **出貨緩衝**：完成生產後，距離 `dueDate` 需要留出的物流/品檢天數。(暫時設定當天做好就能當天交貨) |

> **嚴格規則**：由於每日 0:00 狀態自動轉換，當前日期（Today）永遠視為「鎖定中」(IN_PRODUCTION)，排程視窗最快從 **Today + 1** 開始。

---

## 3. 演算法詳解 (Greedy Best-Fit Strategy)

### A. 資料選取與預處理

1.  **訂單過濾**：撈取狀態為 `APPROVED`, `SCHEDULED`, `IN_PRODUCTION` 且類型匹配的母單。
2.  **產能重置 (In-Memory Reset)**：
    - 引擎啟動時，會先將現有 `SCHEDULED` 狀態的子單數量加回記憶體中的 `curCapacity`。
    - 這樣可確保「重新排程」時，系統是基於「剩餘總產能」重新尋找最佳解。
3.  **剩餘需求量 (Remaining Qty) 計算**：
    - 公式：`RemainingQty = Order.Total - (COMPLETED + IN_PRODUCTION)`。
    - 我們只排程「尚未進入產線且尚未完成」的部分。

### B. 排程 Time Window 定義

- **開始日期 (WindowStart)**: `Today + 1 + frozenDays`
- **結束日期 (WindowEnd)**: `dueDate - bufferDays - (productionDays - 1)`

### C. 分配邏輯

1.  **訂單優先級**：按照 `dueDate` (升序) > `quantity` (降序) > `createdAt` (升序) 排序。
2.  **動態產能生成 (Dynamic Initialization)**：若某日期尚無產能記錄，引擎會根據工廠的 `maxCapacity` 動態創建虛擬產能。
3.  **最佳擬合**：優先選擇「剩餘產能最大」的工廠進行分配，以減少產能分配不均。
4.  **訂單拆分 (Order Splitting)**：若單一工廠/日期無法滿足需求，訂單會自動拆分至多個工廠或多個日期。

### D. 變更紀錄與回滾機制 (Rollback)

- 為了避免 $O(N \times M)$ 的快照拷貝開銷，系統採用輕量的 **Mutation Ledger (變更紀錄)** 機制。
- 在處理每一張訂單時，系統會建立一個陣列來記錄所有的產能扣除與動態創建。
- 若該訂單在整個視窗內無法被 100% 滿足（`RemainingQty > 0`），則觸發 **Rollback**：
  - 反向遍歷 Ledger，將扣除的產能精準加回，並刪除動態創建的虛擬產能紀錄。
  - 捨棄該訂單的所有虛擬分配。
  - 母單狀態設為 `APPROVED`（若原為 `IN_PRODUCTION` 則保持不變，防止狀態降級）。

---

## 4. 寫入與原子性 (Persistence)

為確保資料一致性，所有寫入邏輯集中在 `engine.ts` 的 `prisma.$transaction` 中執行：

1.  **刪除舊排程**：僅刪除受影響訂單中狀態為 `SCHEDULED` 的子單。
2.  **更新母單狀態**：根據排程結果更新為 `SCHEDULED` 或 `APPROVED`。
3.  **更新/新增產能表**：保存因排程而變動的 `DailyCapacity`。
4.  **寫入新分配**：插入新生成的 `OrderAssignment` 記錄。

---

## 5. 觸發機制與可靠性保證 (Triggers & Reliability)

系統設計了兩種觸發路徑，確保生產計畫的即時性與靈活性：

### A. 自動排程 (Scheduled Trigger)

- **頻率**：每 10 分鐘執行一次。常態做法，避免多個管理員同時、連續寫入，白排多次。
- **機制**：透過外部 Cron 服務呼叫 `/api/schedule/run`。
- **安全**：接口受 `CRON_SECRET` 保護，僅限授權服務呼叫。

### B. 管理員強制排程 (Admin Manual Trigger)

- **路徑**：管理者介面 -> 「立即更新排程」按鈕。
- **權限**：嚴格限制 `SUPERADMIN` 與 `ADMIN` 角色。
- **用途**：保留管理員手動應對緊急訂單插單等場景。

### C. 並發控制 (Concurrency Control)

- **Redis 分散式鎖**：無論是自動還是手動觸發，系統在執行前會先嘗試獲取 `schedule:lock:[type]`。
- **Fail-fast 策略**：若已有排程正在執行，新的請求會立即回傳 `409 Conflict`，防止重複計算導致的資料庫壓力或競爭條件（Race Condition）。

## 6. 測試規範

本模組強制執行 **TDD (Test-Driven Development)**：

- **Unit Tests**: 驗證演算法在各種極端測資（如大單、產能不足、邊界日期）下的正確性。
- **Integration Tests**: 驗證資料庫 Transaction 邏輯與 Repository 串接。
- **Benchmark**: 驗證在大規模數據（10,000+ 訂單）下的運算效能。
