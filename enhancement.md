# 系統效能優化與重構說明

## 1. 記憶體與查詢優化 (getAffectedOrderTypes)

- **原因**：舊版程式將大量 `OrderAssignment` 資料載入 Node.js 記憶體，再使用程式邏輯去重。這會造成記憶體浪費與網路傳輸瓶頸。
- **修改**：改用 Prisma 的 `distinct` 與關聯查詢。將資料過濾與去重的工作轉交給 PostgreSQL 資料庫層處理，僅回傳必要的字串陣列。

## 2. 解決 N+1 查詢問題 (executeDailyStateAdvancement)

- **原因**：舊版程式在迴圈內針對每筆訂單分別執行 `findUnique` 與 `update`。若有 1000 筆訂單，會在單一 Transaction 內產生 2000 次資料庫請求，易導致操作超時與資料庫連線池耗盡。
- **修改**：將查詢移出迴圈，改用 `findMany` 批次讀取。在記憶體中完成邏輯判斷後，集中使用 `updateMany` 批次寫入。將查詢次數從數千次降低至 5 次以內。

## 3. 狀態更新原子化 (Simulation Time 與 Daily Execution)

- **原因**：原本「更新模擬時間」與「執行每日狀態推進」分為兩個獨立步驟。在雲端高延遲環境下，若中途發生錯誤，會產生時間已推進但排程狀態未更新的資料不一致問題。
- **修改**：將時間更新的參數 (`patch`) 傳遞至底層，與訂單狀態更新合併在同一個 Prisma `$transaction` 內執行。確保兩個操作同時成功或同時失敗（回滾），達成操作的原子性 (Atomicity)。

## 4. 解決 CPU 阻塞問題 (strategy.ts)

- **原因**：排程演算法在分配不可變動訂單 (Immutable Orders) 時，在巢狀迴圈內使用 `Array.find` 尋找工廠，導致 $O(N^2)$ 的時間複雜度。資料量大時會完全阻塞 Node.js 事件迴圈。
- **修改**：在進入迴圈前，預先建立以 `factoryId` 為鍵值的 Hash Map。將查詢時間複雜度由 $O(N)$ 降至 $O(1)$，解決事件迴圈阻塞與 API 超時問題。
