# 系統修改與修復說明

## 1. `seed.ts` 變更與目的

**寫入內容：**

- 每次執行前清空所有訂單與排程相關資料，確保冪等性 (Idempotency)。
- 建立 9 間工廠，將 `maxCapacity` 強制設為 10,000。
- 設定 `SystemState` 的模擬日期為 `2026-06-03`。
- 產生特定分佈的訂單：
  - **Rule 3**：`06-03` 的產能 100% 滿載，狀態為 `IN_PRODUCTION`。
  - **Rule 4**：`06-04` 到 `06-10` 每天消耗 9,000 產能，狀態為 `SCHEDULED`（每天剩餘 1,000 產能）。
  - **Rule 6**：每種生產類型產生 35 筆 `PENDING` 訂單（每筆數量 2,500），總需求為 87,500，且 `dueDate` 壓在 `06-10`。

**目的：**
刻意設計的剩餘產能 (81,000) 與待排程需求 (87,500) 會產生剛好 6,500 的產能缺口。這在數學上保證即使在使用 `GLOBAL_OPTIMIZE` 策略時，每種生產類型也必定會產生 `FAILED` 訂單。

---

## 2. 時區問題與處理

**問題發生原因：**
資料庫中的時間欄位為 `timestamp without time zone`，實際儲存了不含時區的 `2026-06-03 00:00:00`。
當 Prisma 的 `pg` 驅動程式讀取資料時，會預設套用 Node.js 執行環境的本地時區（如台灣 UTC+8）。這導致系統將其誤認為 `2026-06-03 00:00:00 UTC+8`，轉換為絕對時間後變成 `2026-06-02T16:00:00.000Z`，造成所有日期提早了 8 小時。此外，前端的 `parseISO` 與 `toISOString` 混用也導致畫面顯示日期偏移。

**為何不直接將資料庫改為 UTC+8：**
將資料庫或底層基礎設施硬編碼為 UTC+8 是反模式 (Anti-pattern)。伺服器與資料庫應統一保持嚴格的 UTC 時間，以避免跨地區部署或日光節約時間 (DST) 帶來的資料錯亂。業務時區 (Business Timezone) 的轉換應該在應用程式層透過環境變數動態處理。我們必須讓系統能同時支援嚴格的 UTC「模擬模式」與可配置時區的「即時模式」。

**修改的檔案與原因：**

- **`prisma/seed.ts`**
  - 修改：在檔案第一行加入 `process.env.TZ = "UTC"`。
  - 原因：強制執行 Seed 的 Node.js 環境使用 UTC，防止本地時區在寫入資料庫前偏移時間。
- **`lib/get-time.ts`**
  - 修改：區分模式。模擬模式直接回傳嚴格的 UTC 午夜時間；即時模式讀取 `.env` 中的 `BUSINESS_TIMEZONE_OFFSET` 進行計算後，再截斷為 UTC 午夜時間。
  - 原因：確保全系統取得的「當下業務日期」統一且無時區誤差。
- **`app/(dashboard)/visualization/page.tsx`**
  - 修改：移除 `toISOString().split("T")[0]`，改用 `date-fns` 的 `format(d, "yyyy-MM-dd")` 渲染 UI 日期。向 API 傳遞日期時，改以字串拼接 `T00:00:00.000Z` 代替 `new Date().toISOString()`。
  - 原因：防止瀏覽器的本地時區將 UTC 午夜時間往前推移一天。
- **`app/api/system/simulation/route.ts`**
  - 修改：建立新的模擬日期時，以 `Date.UTC` 取代 `new Date()`。
  - 原因：防止 API 寫入帶有本地時區偏移的當下時間。
- **`app/api/schedule/run/route.ts` & `app/api/schedule/preview/route.ts`**
  - 修改：移除 `currentDate.setHours(0,0,0,0)` 等本地時區操作。
  - 原因：API 路由層不應處理時區計算，全交由核心模組處理。
- **`modules/schedule/core.ts`**
  - 修改：使用 `Date.UTC` 計算 `minimumStartDate`。
  - 原因：確保排程起始日的推算不受伺服器本地時區影響。
- **`modules/schedule/strategy.ts`**
  - 修改：將所有 `getFullYear` / `getDate` 方法替換為 `getUTCFullYear` / `getUTCDate`。
  - 原因：確保排程演算法在跨日計算時嚴格遵守 UTC 邊界，解決「6/3 變成 6/2」的 Bug。
- **`.env.example`**
  - 修改：加入時區環境變數。

---

## 4. 自動排程與模擬時間推移功能實作

- **自動排程邏輯重構 (Task 1)**：
  新增 `modules/schedule/auto-scheduler.ts`，將自動排程的核心邏輯由 `scripts/cron.ts` 中抽出。讓自動排程可以同時被 Cron Job（即時模式）與 API（模擬模式）呼叫。

- **修復 Cron Job 時區與加入模擬模式防護 (Task 2)**：
  修改 `scripts/cron.ts`，強制使用 `Asia/Taipei`（或環境變數設定的時區）。
  設定每日午夜執行狀態推進，每兩小時執行一次填補空隙的自動排程。
  加入防護機制：當系統處於模擬模式 (`isSimulationMode: true`) 時，立即中斷 Cron Job 執行。

- **修正產能查詢的日期地板邏輯 (Task 3)**：
  修改 `infra/db/factory-repository.ts` 中的 `findFactoriesWithCapacities`。使用嚴格的 `Date.UTC` 將查詢起始時間精確推算至 UTC 午夜 (`T00:00:00.000Z`)。防止因傳入精確時間（包含小時/分鐘）而遺漏當日剩餘的產能資料。

- **模擬模式 API 與時間推進判定 (Task 4)**：
  修改 `app/api/system/simulation/route.ts` 與新增 `modules/schedule/simulation-service.ts`。當更新模擬時間時，若時間推移跨越了 UTC 午夜（進入新的一天），則觸發狀態推進 (`advanceOrderStatuses`)；若未跨越午夜，則觸發自動排程 (`triggerAutoSchedule`)。

- **前端 "+2h" 模擬控制與時間顯示 (Task 5)**：
  修改 `app/(dashboard)/visualization/page.tsx`。加入 `simDateTime` 狀態以保存精確到分鐘的模擬時間。新增 "+2h" 按鈕，允許使用者在模擬模式下快進時間，藉此觸發且驗證後端的自動排程邏輯。

- **假計時器測試 (Task 0)**：
  新增 `__tests__/scripts/cron/time-logic.test.ts`。使用 `vi.setSystemTime` 驗證模擬模式防護。測試跨越午夜與未跨越午夜的情境。驗證產能查詢的地板時間計算正確。確保所有邏輯在 TDD 規範下實作且通過測試。

## 5. preview邏輯修正

- **修正**：現在如果不勾選任何pending order，preview就不會嘗試排程任何pending order。

## 6. Manual Edit API Guardrails Upgrade

**問題發生原因：**
原本的 Manual Edit 只是更新 `SCHEDULED` 訂單的日期，並未將「超出產能」與「超過交期」的檢查放進後端 API 阻擋，而是單純依賴前端畫面上的視覺警告。同時不支援將 `PENDING` 狀態的訂單透過拖拉排入排程。

**修改的檔案與原因：**

- **`modules/schedule/validation-utils.ts`**
  - 新增：將排程核心的 deadline 計算邏輯抽出，以便後續跨模組共用。
- **`modules/schedule/manual-edit-service.ts`**
  - 修改：更新 `AssignmentMove` 介面，支援可選的 `orderId` 以處理 `PENDING` 訂單的拖放。
  - 修改：實作 `applyAssignmentMoves`。利用 `Map` 建立 in-memory capacity ledger 累計計算連續拖動造成的產能變化。
  - 新增：加入 "Fail-Fast" 驗證機制。執行 `$transaction` 前，呼叫共用的 `calculateOrderDeadline` 檢核是否超時，並檢查是否超出工廠產能上限，若違規立刻拋出自訂的 `ManualEditValidationError` 包含違規項目。
  - 修改：移除了直接對 `db.order` / `db.autoSchedulerConfig` 查詢等違反層級架構的 Prisma 語法，全數依賴 repo 層呼叫。
- **`infra/db/order-repository.ts`**
  - 新增：`bulkUpdateOrderModifiedBy` 與 `bulkUpdateOrderStatusAndModifiedBy` 提供 `manual-edit-service` 使用，維持資料庫存取層的安全。
- **`app/api/assignments/bulk/route.ts`**
  - 修改：Zod Schema 更新為支援 `orderId`。
  - 修改：捕捉 `ManualEditValidationError` 錯誤，回傳 `400 Bad Request` 加上結構化的錯誤訊息，供前端拒絕儲存並顯示提示。
- **`__tests__/modules/schedule/manual-edit-service.test.ts`**
  - 新增：針對「超出產能」、「違規交期」、「成功排入 PENDING 訂單」與「成功移動 SCHEDULED 訂單」四種情境的嚴格 TDD 測試。

- **前端對接建議 (Frontend Integration Guide)**
  - 當使用者在編輯模式下拖拉尚未排程的 `PENDING` 訂單進入甘特圖時，前端應在送出儲存時，呼叫 `PATCH /api/assignments/bulk`，並將該筆異動以 `{ orderId: "...", factoryId: "...", productionDate: "YYYY-MM-DD" }` 的格式加入 `moves` 陣列。
  - 前端應捕捉 `400 Bad Request` 回應，解析 `violations` 陣列，並將 `CAPACITY_EXCEEDED` 或 `DEADLINE_VIOLATION` 的錯誤訊息直接對應用戶介面上導致衝突的訂單卡片，藉此阻擋無效的排程操作。
