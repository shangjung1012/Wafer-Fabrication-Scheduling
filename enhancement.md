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

## 5. 前端請求批次化與解決快取問題 (Conflict Issues)

- **原因**：前端發送多個獨立的 API 請求獲取不同狀態的衝突訂單，造成 N+1 網路瀑布效應。同時，Next.js App Router 預設強制快取 API 回傳結果，導致畫面無法顯示最新狀態。
- **修改**：
  - 前端將多個狀態合併為單一請求 (如 `?statuses=OPEN,IN_DISCUSSION`)，並使用 `Promise.all` 改為單次 `apiFetch`。
  - 前端 `apiFetch` 函式中加入 `cache: "no-store"`，強制瀏覽器與 Next.js 路由不使用快取。
  - 後端 `route.ts` 接收陣列參數，以便資料庫使用 `in` 操作符批次查詢。
  - 於 API 路由頂部加入 `export const dynamic = "force-dynamic";` 以停用預設快取，確保回傳最新資料。

## 6. 解決 N+1 寫入問題與狀態批次更新 (Conflict Issue Repository)

- **原因**：當接受某項提案時，舊版程式在 `staleOtherProposals` 內使用迴圈逐筆更新其他留言的狀態為 `STALE`。這會產生多筆獨立的資料庫更新操作 (N+1 寫入問題)。
- **修改**：將所有的更新操作先收集為陣列，再使用 Prisma 的 `$transaction` 包裝執行。確保所有狀態更新在單一資料庫交易內完成，減少網路來回時間並提升寫入效能。

## 7. 背景任務平行化處理 (Conflict Issue Service)

- **原因**：在 `createIssuesForFailedOrders` 中，系統使用循序的 `for` 迴圈逐一處理排程失敗的訂單。若同時有大量訂單失敗，循序處理會導致長時間的阻塞，並產生大量的 N+1 循序讀取。
- **修改**：將循序迴圈改為分批平行處理 (Chunked Parallel Processing)。將每 5 筆訂單分為一組，利用 `Promise.all` 同時執行。在提升處理吞吐量的同時，也能保護資料庫連線池避免被瞬間大量請求耗盡。
