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

## 7. 徹底消除 N+1 批次讀取 (Conflict Issue Service)

- **原因**：在 `createIssuesForFailedOrders` 中，系統使用循序的 `for` 迴圈逐一處理排程失敗的訂單。若同時有大量訂單失敗，循序處理會導致長時間的阻塞，並產生大量的 N+1 循序讀取。每筆失敗訂單會觸發 4 次獨立的資料庫查詢 (訂單、工廠、競爭訂單、開放中的 Issue)。
- **修改**：將循序迴圈內的查詢全數提取為批次查詢。現在 `prepareIssueCreationPrep` 僅執行 4 次批次查詢 (`findMany` with `in`)，無論失敗訂單數量多寡。資料在記憶體中按訂單過濾並組合，不再需要平行處理或 Chunked Pipeline。

## 8. 確保衝突訂單建立之效能與資料一致性 (Atomicity & Bulk Insert)

- **原因**：使用 `Promise.all` 進行平行寫入雖能提升吞吐量，但大量併發的資料庫請求在 Azure 雲端環境容易導致 SNAT port 或連線池耗盡 (Connection Pool Exhaustion)。此外，同一批次的寫入若發生部分失敗，將導致資料庫產生「半殘」的髒資料，破壞系統的一致性。
- **修改**：
  - **單一連線交易**：將整個 Chunk 處理邏輯包裝進單一的 `prisma.$transaction`，改以順序處理記憶體計算，保證整個批次同生共死 (Atomicity)，且每個 Chunk 只佔用一條資料庫連線。
  - **批次寫入 (Bulk Insert)**：消滅了迴圈內的獨立 `create` 操作，將資料在記憶體中整理為陣列後，透過單次 `createMany` 批次寫入資料庫，最大化網路傳輸效率與寫入效能。
  - **延遲副作用 (Deferred Side-effects)**：將寄送 Email 的行為封裝為 Thunks，等待資料庫交易安全 `commit` 之後才觸發，避免因 Email 寄送錯誤導致資料庫 Rollback。透過 `queueMicrotask` 延遲 `.map()` 執行，確保 HTTP Response 在主執行緒阻塞之前回傳，前端不會被 Email 發送延遲卡住。

## 9. 每日更新邏輯加強

- **原因**：一次加一天不會出問題，一次推進多天就是出現錯誤的更新邏輯。
- **修改**：修改判斷邏輯，很簡單的修正。

## 10. 嚴格原子性與快照正確性 (Conflict Issue Service + core.ts)

- **原因**：FAILED訂單產生，但對應ConflictIssue產生是另一個任務，有時會出現沒有產生的資料汙染。此外，ConflictIssue 的 contextSnapshot 中的 `totalAvailableInWindow` 記錄的是排程前的剩餘產能（18000），而非排程後的真實可用產能（200），導致前台顯示「訂單量 2500 無法裝入 18000 的產能」的不合理訊息。
- **修改**：
  - **嚴格原子性**：把函式嚴格包裝在一起，確保排程apply的時候可以讓FAILED跟對應的衝突物件一起產生，或至少一起失敗。
  - **快照時機修正**：將 `prepareIssueCreationPrep` 的呼叫從 Transaction 外部移入 Transaction 內部，放在所有產能更新（`bulkUpdateDailyCapacities`、`createAssignments`）之後執行。確保 snapshot 中的 `totalAvailableInWindow` 反映的是排程後的剩餘產能，讓 deficit 計算合理。
  - **重構測試**：修正整合測試 (`auto-issue-creation.test.ts`) 與單元測試，不再使用冗餘的 API 呼叫來檢驗建立流程，而是直接斷言 `runSchedule` 結束後資料庫所產生的原子化結果，讓測試真實反映正式環境的穩健性。

## 11. 批次查詢重構 (prepareIssueCreationPrep)

- **原因**：`prepareIssueCreationPrep` 為每筆失敗訂單執行 4 次獨立查詢 (`findUnique`/`findFirst`/`findMany` with 單一參數)，共 4N 次資料庫請求。雖已不在 Transaction 內執行，但 N 較大時仍會累積可觀延遲。
- **修改**：新增 4 個批次版 repository 函式 (`findOrdersForIssueCreationBatch`、`findFactoriesForIssueSnapshotBulk`、`findOpenIssuesByOrderIds`、`findCompetingScheduledOrdersBatch`)。`prepareIssueCreationPrep` 改為先執行 4 次批次查詢收集所有資料，再於記憶體中依訂單過濾與組合。資料庫請求從 4N 降至 4 次，與 N 無關。

## 12. Email 發送非同步化優化

- **原因**：Email Client 初始化 (`new EmailClient(invalidUrl)`) 每次呼叫耗時約 100ms。若同時有 24 封 Email，`.map()` 會同步依序執行所有建構子，累計阻塞約 2.4 秒，導致 HTTP Response 在前端等待期間逾時或體驗不佳。
- **修改**：
  - **失敗快取**：`getEmailClient()` 在第一次建構失敗後設定 `emailClientInitFailed = true`，後續呼叫立即拋出 `MailConfigurationError`，不再重試建構子。將 24 × 100ms 降至 1 × 100ms。
  - **微任務延遲 (queueMicrotask)**：將 Email 派送邏輯包裹在 `queueMicrotask` 內，確保 `return { failedIds }` 在主執行緒上優先執行，前端取得 Response 後才處理 Email 發送。
