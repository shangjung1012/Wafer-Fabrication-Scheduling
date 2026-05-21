# 新增功能總覽

> **重要**：Section 1（演算法 registry）與 Section 2.2（preview / algorithms-list 設計）已被 Section 7 的重構**取代**。閱讀時以 Section 7 為當前狀態。

---

## 1. 排程引擎重構：演算法可插拔架構 \_(已被 Section 7 取代)

---

## 2. 視覺化「預覽 + 手動編輯」功能鏈

> 一條完整的「選演算法 → 預覽結果 → 拖拉微調 → 批次儲存」工作流，限 Admin / Superadmin 使用。

### 2.1 Timeline 暴露 `assignmentId`

**Commit：** `537f5cb` `feat(visualization): include assignmentId in timeline items`

- 為後續拖拉行為鋪路，讓前端可精準鎖定某一筆派工單

### 2.2 預覽 + 演算法清單 API _(已被 Section 7 取代)_

### 2.3 批次搬移派工單 API

**Commit：** `3f6f950` `feat(schedule): add bulk assignment-move API for manual edits`

- `PATCH /api/assignments/bulk`：在單一 transaction 內處理多筆派工單移動
  - 拒絕非 `SCHEDULED` 狀態的派工單
  - 自動退/扣 `DailyCapacity`
  - 目的地若無 capacity 列則新建
- 回傳 `{applied, errors}` — 部分失敗可逐筆呈現

### 2.4 Admin Gantt UI

**Commit：** `c161519` `feat(visualization): admin algorithm dropdown, preview, and drag/drop edit mode`

- **Algorithm 下拉**：列出 registry 中所有可用演算法
- **Preview 按鈕**：呼叫 preview API 後在 Gantt 上疊出預測 timeline、diffs、conflicts；提供 Apply / Discard
- **Edit 模式**：dnd-kit 把每個 cell 變 drop target，`SCHEDULED` 派工單變成可拖拉 chips；非 `SCHEDULED` 派工單顯示 🔒
  - 拖拉時即時重算 capacity / conflict 疊圖
  - Save 透過 bulk API 提交，逐筆錯誤會顯示

---

## 3. Profile 頁 + 驗證式 Email 變更流程

**主要 Commit：** `d788d70` `feat(profile): add verified email change flow`
**後續修正：** `e29c78f` (sync setState), `9b2f9d3` (Suspense 包裝 `useSearchParams`)
**合併 PR：** #23, #24, #25

- **流程改為兩步驟驗證**（取代直接 PATCH email）：
  1. `POST /api/users/me/request-email-change`
  - 驗證使用者密碼
  - 建立 3 分鐘 TTL 的 `EmailChangeToken`
  - 發兩封信：給新地址的驗證連結 + 給舊地址的安全通知
  2. `GET /api/users/me/verify-email`
  - 驗 token → 原子性更新 `user.email` + 標記 token 已用
  - 完成後 redirect 回 `/profile`
- `GET /api/users/me` 取代舊的 PATCH 路徑，讓 profile 頁可重抓更新後的使用者資料而不必強制登出
- Profile 頁收到 `?emailUpdated=true` 會用 `persistClientAuthSession()` 重整 localStorage；`?emailError=*` 各種狀態都有對應的人類可讀訊息
- 3 分鐘等待期間禁止重複送出

**影響檔案：**

- `app/api/users/me/request-email-change/route.ts`（新）
- `app/api/users/me/verify-email/route.ts`（新）
- `app/api/users/me/route.ts`（改）
- `modules/mail/templates/email-change-{notify,verify}.ts`（新）
- `app/(dashboard)/profile/page.tsx`（改）
- Prisma model `EmailChangeToken` + migration `20260517025905_add_email_change_token`

---

## 4. Simulation Date Mode（系統時間模擬模式）

**主要 Commit：** `b292aff` `feat: add simulation date mode for scheduling engine`
**後續修正：** `cb3c1fc` (套用至 viz service + PendingSidebar today), `3ddc04e` (refresh 控件)
**合併 PR：** #26, #29

讓 Admin 可以把整個系統的「現在時間」切到指定日期，用來測試排程演算法面對未來日期的行為。

- **新增 `SystemState` model**（單例，固定 id `"global"`）：
  - `isSimulationMode: boolean`
  - `simulationDate: DateTime | null`
- `**lib/get-time.ts`\*\*：全域 `getTime()` 工具
  - 模擬模式開啟 → 回傳 `simulationDate`
  - 否則 → 回傳 `new Date()`
- **影響範圍**：
  - `modules/schedule/engine.ts`：以 `getTime()` 取代 `new Date()`
  - `infra/db/factory-repository.ts`：`findFactoriesWithCapacities` 加入 `currentDate` 參數，篩選未來 capacity
  - `modules/visualization/service.ts`：`today` 由 server 端 `getTime()` 決定，並隨 `TimelineResponse` 一起回傳
  - `PendingSidebar`：「N 天逾期 / N 天到期」標示遵循模擬日期
- **UI 控件**（視覺化頁面頂部 mode bar）：
  - Auto / Manual 切換
  - Manual 模式下顯示日期 input + ←-1d / +1d→ 按鈕
  - 顯示目前正在模擬哪一天

**影響檔案：**

- `app/api/system/simulation/route.ts`（新，GET/PATCH 端點）
- `infra/db/system-state-repository.ts`（新）
- `lib/get-time.ts`（新）
- Prisma model `SystemState` + migration `20260517091653_add_system_state`

---

## 5. Dashboard 整合

**Commit：** `f3f84a5` `merge dashbroad and visualization`

帶入新的 dashboard 頁面與元件（fast-forward merge，無衝突）：

- `app/(dashboard)/visualization/dashboard/page.tsx`（新）
- `components/dashboard/DashboardShell.tsx`（新）— 整體外框
- `components/dashboard/DashboardSummary.tsx`（新）— 統計卡片
- `components/dashboard/AdminPendingSection.tsx`（新）— Admin 視角的待審訂單
- `components/dashboard/SalesOrdersSection.tsx`（新）— Sales 視角的自己訂單
- `components/dashboard/MessagesSection.tsx`（新）— 訊息區

---

## 6. Merge `dev`

**Commit：** `3f4da45` `merge dev: simulation date + email change flow`（2026-05-18）

把 **Section 3（email 變更）** 與 **Section 4（simulation date）** 兩條從 `dev` 進來的功能，整合進 `feat/sales-visual`（已有 Section 1, 2, 5 的功能）。

### 解決的衝突

| 檔案                                     | 解決策略                                                                                                                                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modules/schedule/engine.ts`             | 保留 sales-visual 的 algorithm registry / `simulateSchedule` 拆分；把 dev 的 `await getTime()` 注入 `simulateSchedule` 取代 `new Date()`，讓 simulation date 能驅動排程                       |
| `app/(dashboard)/visualization/page.tsx` | 5 個衝突塊全部「並存」處理： • `PendingSidebar` 同時接受 `today` + `onEditOrder` + `onCreate` • 演算法/preview/edit-mode state 與 simulation state 並列 • `effective` useMemo / `handleCreate |

---

## 7. Merge `feat/schedule-refactor`：兩階段 preview/apply + reschedulePolicy（本次）

**Commit：** `7c56701` `merge feat/schedule-refactor: previewId/apply two-phase + reschedulePolicy`（2026-05-18）

整段排程架構重寫，把 Section 1 / 2.2 的 algorithm registry + 單次 preview 取代成更穩固的兩階段流程，並把衝突訊號正規化到狀態機。

### 7.1 兩階段 Preview / Apply（取代單次 preview）

| 階段 | Endpoint                     | 行為                                                                                                       |
| ---- | ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 預覽 | `POST /api/schedule/preview` | dry-run 排程；把 `StrategyResult` 連同 `previewToken` 寫進 Redis（TTL）；回 `{ previewId, data: { ... } }` |
| 套用 | `POST /api/schedule/apply`   | 用 `previewId` 取出 Redis 內容；透過 OCC token 比對最新 DB 狀態；不變才寫入                                |

**OCC（樂觀並行控制）**

- preview 當下抓快照、計算結果、記下 token
- apply 時若 DB 狀態已被別人改 → 回 **409 CONFLICT**，要求重新預覽
- UI 收 409 後自動清掉 `previewId` 並提示「資料已變更，請重新預覽」

**Request body：** `{ type, config: { reschedulePolicy, frozenDays, productionDays, bufferDays, algorithm: "GREEDY_BEST_FIT", splittable } }`

**Response：** `{ previewId, data: { newSchedule, affectedOrders, failedOrderIds, conflictOrderIds, conflictOrders, conflictWarnings } }`

### 7.2 `reschedulePolicy`（取代 algorithm registry）

三種固定策略，編譯期決定，無 runtime registry：

| Policy            | 行為                                                      |
| ----------------- | --------------------------------------------------------- |
| `GLOBAL_OPTIMIZE` | 釋放所有既有 SCHEDULED 容量，重排整批訂單以求全域最佳     |
| `PRIORITY_RETAIN` | 既有 SCHEDULED 訂單享有加分，盡量不動現況；只在必要時擠掉 |
| `GAP_FILLING`     | 不釋放既有 SCHEDULED 容量，新訂單只能塞空隙               |

設定欄位（在 `config` 物件內）：

- `frozenDays` / `productionDays` / `bufferDays`：排程視窗
- `splittable`：訂單能否拆派到多個工廠/日期
- `algorithm`：目前固定 `"GREEDY_BEST_FIT"`（保留未來擴充欄位）

### 7.3 訂單旗標 + 失敗狀態

**Migration：** `20260517141725_add_order_flags_and_failed_status`

`**Order` 新欄位：\*\*

- `isFixed: Boolean`：鎖定該訂單，所有 reschedulePolicy 都不會動它
- `isPrioritized: Boolean`：排程優先序加權，與 reschedulePolicy 互動

`**OrderStatus` enum 變更：\*\*

- 新增 `FAILED`（排程失敗 — 視窗內容量不足、無法排入）
- 移除 `APPROVED`（已不在新狀態機中）

### 7.4 衝突偵測：從 engine.ts 搬到 strategy.ts

| 訊號                 | 範圍     | 意涵                                                |
| -------------------- | -------- | --------------------------------------------------- |
| `OrderStatus.FAILED` | 寬鬆     | 這次排程沒排上（下次可能能）                        |
| `conflictOrderIds`   | 嚴格子集 | 視窗內所有工廠的總容量都不足 — **真衝突**，再跑無解 |

`computeTotalAvailableCapacity` helper 逐日掃視窗，加總所有工廠的 `curCapacity`（無 DB 記錄者取 `maxCapacity`）。若 `total < startingRemainingQty` → 推入 `conflictOrderIds`。

**Preview 回傳的 `conflictOrders`：** 由 `modules/schedule/conflict.ts` 的 `fetchConflictOrders(db, ids)` hydrate — 含 `id / name / quantity / dueDate / applicantEmail / applicantUsername / adminEmail / adminUsername`。UI 直接拿來顯示在衝突 banner，無需再打額外 API。

### 7.5 寄信：完全手動

- `/api/schedule/run` **不**自動寄信（拿掉 `CONFLICT_EMAIL_AUTO_SEND`、`renderAndSend` 等所有 fire-and-forget 流）
- `/api/schedule/notify` 仍是手動端點；UI 在 conflict banner 上有「通知」按鈕，明確按下才送
- 客戶端會 filter 至少有 `applicantEmail || adminEmail` 的 order 才送，避免 server 收到無寄信對象的 entry

### 7.6 模組拆分

| 新檔                            | 職責                                                          |
| ------------------------------- | ------------------------------------------------------------- |
| `modules/schedule/core.ts`      | 入口 + 依 reschedulePolicy 派發策略                           |
| `modules/schedule/run.ts`       | 一氣呵成跑 strategy + 寫 DB（給 `/api/schedule/run`）         |
| `modules/schedule/preview.ts`   | dry-run + Redis 寫 previewId（給 `/api/schedule/preview`）    |
| `modules/schedule/config.ts`    | `SchedulingConfig` 型別定義 + defaults                        |
| `modules/schedule/strategy.ts`  | 核心 greedy 演算法 + 衝突偵測（從舊 engine.ts 抽出並加強）    |
| `modules/schedule/conflict.ts`  | `fetchConflictOrders` 助手；對接 notify route                 |
| `infra/redis/schedule-store.ts` | Preview 資料的 Redis 存取層（set / get / delete + OCC token） |
| `lib/redis.ts`                  | Redis client singleton                                        |

**刪除：**

- `modules/schedule/engine.ts`、`modules/schedule/algorithms.ts`、`modules/schedule/preview-service.ts`
- `app/api/schedule/algorithms/`（含 route.ts）
- `__tests__/modules/schedule/engine.test.ts`、`engine-kickout.test.ts`

### 7.7 Redis 分散式鎖（順序修正）

`/api/schedule/run` 用 `schedule:lock:${type}` 為 key 取得 Redis lock（`SET NX EX 300`）。

**本次 merge 修正**：lock 取得移到 `await getTime()` **之前**，輸家可以**立即** 409 不必先打 DB（race condition 測試從 ~600ms 降回 < 250ms 的 fail-fast 行為）。

### 7.8 UI 變更（`/visualization` 頁）

| 區塊                  | 變化                                                                                              |
| --------------------- | ------------------------------------------------------------------------------------------------- | --- | -------- | --- | -------- | --- | ----------------------------------------------------------------------------------------------- |
| 演算法下拉            | 從 algorithm registry 改為三個固定 `reschedulePolicy` option（GAP_FILLING 為預設）                |
| Preview 按鈕          | 改打新 endpoint，送 `{ type, config }`；收 `{ previewId, data }`                                  |
| **Apply 按鈕**（新）  | `disabled={!previewId                                                                             |     | applying |     | editMode |     | running}`；點下 → POST `/api/schedule/apply { previewId }`；409 自動清 previewId + 提示重新預覽 |
| Conflict banner       | 資料來源從 `/api/schedule/run` 改為 preview 的 `conflictOrders`；run 不再回 conflicts             |
| **Notify 按鈕**（新） | 在 conflict banner 旁；點下 → POST `/api/schedule/notify { orders }`，成功顯示「已寄出 N 封通知」 |

頁面內加了一個 page-local adapter `convertNewScheduleToPreview()`，把新的 `newSchedule` shape 轉成既有 `SchedulePreviewResponse` 的 timeline 結構，**不**動 `modules/visualization/types`。

### 7.9 模擬時間（getTime）注入新 pipeline

`run.ts` / `preview.ts` / `/api/schedule/run/route.ts` / `/api/schedule/preview/route.ts` 都改用 `await getTime()`（沿用 Section 4 的 simulation date 機制），確保模擬日期能驅動新架構。

### 7.10 影響檔案總表

**新檔：** `modules/schedule/{core,run,preview,config,conflict}.ts`、`infra/redis/schedule-store.ts`、`lib/redis.ts`、`app/api/schedule/apply/route.ts`、9 個 schedule/repository 相關 test

**改寫：** `modules/schedule/strategy.ts`（加 `conflictOrderIds` + helper）、`app/api/schedule/{run,preview}/route.ts`、`app/(dashboard)/visualization/page.tsx`、`infra/db/*.ts`（多個 repository 隨新 schema 調整）、`prisma/schema.prisma` + `seed.ts`、`scripts/benchmark.ts`、`api_spec.yml`

**刪除：** 見 7.6

### 已知 follow-up

- `modules/schedule/README.md` / `conflict.md` 目前主要從 `FAILED` 視角描述，可補強 `conflictOrderIds`（嚴格子集）作為「真衝突」訊號的說明
- UI smoke test（Preview → Apply、Notify、drag-drop edit、simulation date 切換）尚未手動驗證

---

## 整體變化一覽

| 範疇             | 內容                                                                                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| 新增 API（現存） | `POST /api/schedule/preview`（已改新 contract） · `POST /api/schedule/apply` · `POST /api/schedule/notify` · `PATCH /api/assignments/bulk` · `POST /api/users/me/request-email-change` · `GET /api/users/me/verify-email` · `GET /api/users/me` · `GET | PATCH /api/system/simulation` |
| 移除 API         | `GET /api/schedule/algorithms`（algorithm registry 已刪）                                                                                                                                                                                              |
| 新增 DB model    | `EmailChangeToken` · `SystemState`                                                                                                                                                                                                                     |
| 新增 Order 欄位  | `isFixed: Boolean` · `isPrioritized: Boolean` · `OrderStatus.FAILED`                                                                                                                                                                                   |
| 移除 Order 狀態  | `OrderStatus.APPROVED`                                                                                                                                                                                                                                 |
| 新增 migration   | `20260517025905_add_email_change_token` · `20260517091653_add_system_state` · `20260517000000_add_order_flags` · `20260517141725_add_order_flags_and_failed_status`                                                                                    |
| 新增前端頁面     | `/visualization/dashboard`                                                                                                                                                                                                                             |
| 新增前端元件     | Dashboard 系列 5 個元件、Simulation mode bar、reschedulePolicy dropdown、Apply 按鈕、Notify 按鈕、Preview / Edit-mode banner                                                                                                                           |
| 新增工具         | `lib/get-time.ts`（全域時間入口）· `lib/redis.ts`（Redis singleton）· `infra/redis/schedule-store.ts`（preview cache + OCC）                                                                                                                           |
| 排程模組現況     | `core.ts` / `run.ts` / `preview.ts` / `config.ts` / `strategy.ts` / `conflict.ts`                                                                                                                                                                      |
