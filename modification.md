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

## 3. 排程引擎 Bug 修復

- **起始日期邊界 (Hard Boundary) 修復**：
  過去引擎允許將訂單排入 `currentDate`（當日為 `IN_PRODUCTION`，不可排程）。透過在核心模組強制計算並覆寫 `minimumStartDate = currentDate + 1 + frozenDays` 解決。
- **虛假稀缺 (False Scarcity) Bug 修復**：
  演算法在處理已排程的固定訂單時，會重複扣除資料庫已扣除的剩餘產能。修改為「僅針對記憶體中新產生的產能物件進行扣減」。
- **`DailyCapacity` 狀態同步 Bug 修復**：
  在 `GLOBAL_OPTIMIZE` 模式下，被移出訂單的舊日期產能無法正確更新回資料庫。原因是引擎比對了「已在記憶體中還原」的產能。修正方式為從資料庫拉取未經修改的 `dbCapacities` 陣列傳入引擎，讓引擎進行準確的狀態差異比對 (Diffing)。
- **API Payload 遺失 Bug 修復**：
  按下 `RUN` 按鈕時行為始終與 `GAP_FILLING` 相同。原因是前端傳遞的參數格式扁平化，不符合後端 Zod Schema，導致後端自動退回預設值。透過修正前端送出的 JSON 結構解決。
