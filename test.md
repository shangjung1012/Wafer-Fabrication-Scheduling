# 測試說明與 Coverage

本文整理本專案 **Vitest** 測試的配置方式、各目錄負責驗證的範圍，以及 `**pnpm test:coverage`\*\*（`@vitest/coverage-v8`）產出的覆蓋率報表。實際數字會隨程式變動；更新文件時請重新執行 coverage 並替換下方表格（或保留 `coverage/coverage-summary.json` 供機器讀取）。

---

## 執行方式

| 指令                             | 說明                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm test`                      | 一次性跑完全部測試（等同 `vitest run`）。                                                   |
| `pnpm test:watch`                | Watch 模式。                                                                                |
| `pnpm test path/to/file.test.ts` | 單檔。                                                                                      |
| `pnpm test -- -t "pattern"`      | 依名稱過濾。                                                                                |
| `pnpm test:coverage`             | `vitest run --coverage`，於終端機輸出報表並寫入 `coverage/`（含 `coverage-summary.json`）。 |

**環境：** `vitest.config.ts` 使用 `environment: "node"`、`setupFiles: ["dotenv/config"]`。部分整合測試需本機 **Postgres / Redis**（與 `.env` 一致）；CI 見 `.github/workflows/ci.yml`。

**門檻：** 目前 **未** 在 `vitest.config.ts` 設定 `coverage.threshold`；是否達標以團隊自行約定為準。

---

## 測試檔配置（目錄對照）

| 路徑         | 角色                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------- |
| `__tests__/` | 全部 Vitest 測試：API route、modules（含 auth／mail 單元）、infra、整合、RBAC、profile UI。 |

以下依**區塊**說明各測試檔主要驗證什麼（對應 `describe` 主題與行為）。

---

### `__tests__/api/` — HTTP 路由與錯誤映射

| 檔案                                      | 測試重點                                                                                                                |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `api/schedule/route.test.ts`              | `POST /api/schedule/run`：權限、Zod、鎖／OCC 相關行為。                                                                 |
| `api/schedule/preview.test.ts`            | `POST /api/schedule/preview`：preview 流程與錯誤碼。                                                                    |
| `api/schedule/apply.test.ts`              | `POST /api/schedule/apply`：套用 preview、版本衝突等。                                                                  |
| `api/auth/route.test.ts`                  | Auth 路由整合流（cookie／服務互動為主）。                                                                               |
| `api/auth/auth-routes-mocked.test.ts`     | **Mock** `login` / `logout` / `refresh`：JSON 與 cookie 路徑、CSRF 403、Zod 400、服務層 401。                           |
| `api/system/simulation-route.test.ts`     | `GET`/`PATCH /api/system/simulation`：認證、Zod、`handleSimulationTimeAdvance` 與僅 `upsertSystemState` 分支、空 body。 |
| `api/conflict-issues/route.test.ts`       | `GET /api/conflict-issues`：`statuses=` 解析、無效 token 過濾、未帶 query、401。                                        |
| `api/conflict-issues/suggestions.test.ts` | 衝突議題建議 API／`getSuggestions` 與 Prisma mock。                                                                     |
| `api/invitation-route.test.ts`            | 邀請註冊／重送等 invitation 相關路由與權限。                                                                            |

---

### `__tests__/modules/` — 業務邏輯（不依賴真實 DB 為主）

| 檔案                                           | 測試重點                                                                                                       |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `modules/schedule/strategy.test.ts`            | **Greedy Best-Fit** 純演算法、rollback、排序（含 `isPrioritized`）、completionDate 等。                        |
| `modules/schedule/core.test.ts`                | `prepareSchedulingData` / transaction 準備與核心路徑。                                                         |
| `modules/schedule/preview.test.ts`             | `previewSchedule` 不寫 DB 的預覽流程。                                                                         |
| `modules/schedule/run.test.ts`                 | `runSchedule` 與鎖、寫入協調。                                                                                 |
| `modules/schedule/manual-edit-service.test.ts` | `applyAssignmentMoves` 手動拖曳／批量調整。                                                                    |
| `modules/schedule/daily-execution.test.ts`     | 每日狀態推進與 `withScheduleLock` 互動（含 `executeDailyStateAdvancement` 第二參數）。                         |
| `modules/schedule/validation-utils.test.ts`    | `calculateOrderDeadline`、`calculateMinimumStartDate` 等日期視窗工具。                                         |
| `modules/order/conflict-issue-service.test.ts` | `createIssuesForFailedOrders`、`listConflictIssues`（SALES／ADMIN 與 `statuses` 合併）、`acceptProposal` OCC。 |
| `modules/users/user-service.test.ts`           | **User 服務層**：`listUsers`／`create`／`update`／`delete` 與 RBAC、`Forbidden`／`NotFound`。                  |
| `modules/mail/mail-template.test.ts`           | `renderAndSend` 等模板寄送封裝。                                                                               |
| `modules/mail/mail-service.test.ts`            | `mail-service`：寄件抽象與錯誤處理。                                                                           |
| `modules/auth/auth-service.test.ts`            | 註冊／登入／refresh 等 `auth-service` 核心流程。                                                               |
| `modules/auth/require-auth.test.ts`            | `requireAuth`：Bearer、Cookie、`DEV_STATIC_TOKEN` 等分支。                                                     |
| `modules/auth/with-auth.test.ts`               | `withAuth` 包裝與 HTTP 錯誤映射。                                                                              |
| `modules/auth/token.test.ts`                   | `token-service`：簽發與驗證。                                                                                  |
| `modules/auth/password.test.ts`                | `password-service`：雜湊與驗證。                                                                               |
| `modules/auth/client-session.test.ts`          | 前端 `client-session` 序列化邊界。                                                                             |
| `modules/auth/invitation-service.test.ts`      | 邀請建立／接受流程。                                                                                           |
| `modules/auth/email-change-route.test.ts`      | 換信相關路由行為（與 email-change 流程銜接）。                                                                 |

---

### `__tests__/infra/` — Repository／Redis

| 檔案                                         | 測試重點                                                                                                                          |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `infra/db/order-repository.test.ts`          | 訂單查詢／更新等 Prisma 呼叫形狀（mock）。                                                                                        |
| `infra/db/assignment-repository.test.ts`     | 派工相關 repository。                                                                                                             |
| `infra/db/conflict-issue-repository.test.ts` | `findConflictIssueByNumber`、`findConflictIssues`（`statuses` 空／非空）、`staleOtherProposals` 批次 `$transaction`。             |
| `infra/db/user-repository.test.ts`           | **User repository**：`findUsers`、`findUserById`、`createUser`、`updateUser`、`deleteUser`、`findUserByUsername`（mock Prisma）。 |
| `infra/db/repositories.test.ts`              | 版本失效 hook 等跨 repository 行為。                                                                                              |
| `infra/redis/schedule-store.test.ts`         | Redis preview／版本鍵讀寫語意。                                                                                                   |

---

### `__tests__/integration/` — 真實 DB／Redis

| 檔案                                      | 測試重點                                                         |
| ----------------------------------------- | ---------------------------------------------------------------- |
| `integration/schedule-engine.test.ts`     | 排程引擎端到端（Postgres）。                                     |
| `integration/redis-lock.test.ts`          | `schedule:lock:*` 等分散式鎖行為。                               |
| `integration/auto-issue-creation.test.ts` | 訂單變 `FAILED` 後自動建立 `ConflictIssue` 與事件／idempotency。 |

---

### `__tests__/rbac/` — 資料範圍與角色

| 檔案                              | 測試重點                                                                      |
| --------------------------------- | ----------------------------------------------------------------------------- |
| `rbac/order-rbac.test.ts`         | 訂單生命週期與 **scope 隔離**（多角色流程）。                                 |
| `rbac/visualization-rbac.test.ts` | 時間軸／視覺化：`myOrderIds`、ADMIN 廠別範圍等（含 sales-1/2/3 兩兩不重疊）。 |

---

### `__tests__/scripts/` — Cron／模擬時間

| 檔案                              | 測試重點                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `scripts/cron/time-logic.test.ts` | 模擬時間前進、`handleSimulationTimeAdvance` 與 `advanceOrderStatuses`／`triggerAutoSchedule` 呼叫契約。 |

---

### `__tests__/profile/` — 儀表板頁面（jsdom）

| 檔案                            | 測試重點                                                                          |
| ------------------------------- | --------------------------------------------------------------------------------- |
| `profile/profile-page.test.tsx` | `ProfilePage`（`@vitest-environment jsdom`）：mock Next／session 下的渲染與互動。 |

---

## Coverage 報表

- **產生時間基準：** 請以本機最後一次 `pnpm test:coverage` 為準；下列數字來自 `**coverage/coverage-summary.json`\*\*（與終端機表格一致）。
- **總覽**

| 指標           | 覆蓋率                    |
| -------------- | ------------------------- |
| **Statements** | **76.9%**（1658 / 2156）  |
| **Branches**   | **61.88%**（776 / 1254）  |
| **Functions**  | **80.73%**（285 / 353）   |
| **Lines**      | **78.98%**（1601 / 2027） |

- **測試執行：** 41 個 test 檔、238 筆測試通過（與最近一次 CI 本機跑法一致時）。

### 依檔案（納入 coverage 的原始碼）

| File                                               | % Stmts | % Branch | % Funcs | % Lines |
| -------------------------------------------------- | ------- | -------- | ------- | ------- |
| `app/(dashboard)/profile/page.tsx`                 | 45.71   | 29.57    | 41.17   | 49.46   |
| `app/api/auth/_cookies.ts`                         | 94.11   | 100      | 100     | 93.75   |
| `app/api/auth/_shared.ts`                          | 85.71   | 77.77    | 100     | 85.71   |
| `app/api/auth/invitations/accept/route.ts`         | 61.53   | 25       | 100     | 61.53   |
| `app/api/auth/login/route.ts`                      | 93.75   | 75       | 100     | 93.33   |
| `app/api/auth/logout/route.ts`                     | 95.23   | 83.33    | 100     | 95      |
| `app/api/auth/refresh/route.ts`                    | 95.23   | 83.33    | 100     | 95      |
| `app/api/auth/register/route.ts`                   | 100     | 100      | 100     | 100     |
| `app/api/conflict-issues/route.ts`                 | 57.89   | 30       | 100     | 68.75   |
| `app/api/schedule/apply/route.ts`                  | 72.72   | 57.89    | 50      | 75      |
| `app/api/schedule/preview/route.ts`                | 76.47   | 58.33    | 85.71   | 78.12   |
| `app/api/schedule/run/route.ts`                    | 91.3    | 92.85    | 50      | 95.45   |
| `app/api/system/simulation/route.ts`               | 81.81   | 76.66    | 100     | 81.39   |
| `app/api/users/route.ts`                           | 80.76   | 40       | 100     | 80.76   |
| `app/api/users/[id]/invitation/resend/route.ts`    | 35.71   | 0        | 100     | 41.66   |
| `app/api/users/me/request-email-change/route.ts`   | 63.88   | 38.88    | 100     | 63.88   |
| `app/api/users/me/verify-email/route.ts`           | 75.86   | 50       | 100     | 75.86   |
| `components/dashboard/AppHeader.tsx`               | 84.61   | 61.11    | 75      | 84.61   |
| `infra/db/assignment-repository.ts`                | 73.33   | 50       | 75      | 90      |
| `infra/db/capacity-repository.ts`                  | 50      | 50       | 50      | 50      |
| `infra/db/conflict-issue-repository.ts`            | 62.85   | 66.66    | 50      | 67.74   |
| `infra/db/factory-repository.ts`                   | 81.81   | 66.66    | 75      | 90      |
| `infra/db/order-repository.ts`                     | 81.13   | 69.49    | 88.23   | 86.66   |
| `infra/db/system-state-repository.ts`              | 33.33   | 0        | 0       | 33.33   |
| `infra/db/user-repository.ts`                      | 100     | 80       | 100     | 100     |
| `infra/db/visualization-repository.ts`             | 88.88   | 57.89    | 84.61   | 100     |
| `infra/redis/schedule-store.ts`                    | 100     | 88.88    | 100     | 100     |
| `lib/generated/prisma/client.ts`                   | 100     | 100      | 100     | 100     |
| `lib/generated/prisma/enums.ts`                    | 100     | 100      | 100     | 100     |
| `lib/generated/prisma/internal/class.ts`           | 100     | 100      | 100     | 100     |
| `lib/generated/prisma/internal/prismaNamespace.ts` | 100     | 100      | 100     | 100     |
| `lib/get-time.ts`                                  | 100     | 100      | 100     | 100     |
| `lib/prisma.ts`                                    | 100     | 75       | 100     | 100     |
| `lib/redis.ts`                                     | 75      | 75       | 50      | 75      |
| `modules/auth/auth-service.ts`                     | 89.47   | 80.85    | 87.5    | 89.47   |
| `modules/auth/client-session.ts`                   | 78.12   | 62.5     | 66.66   | 82.14   |
| `modules/auth/email-change-service.ts`             | 83.87   | 70.58    | 100     | 89.28   |
| `modules/auth/invitation-service.ts`               | 85.71   | 67.74    | 93.75   | 85.71   |
| `modules/auth/password-service.ts`                 | 80      | 50       | 100     | 80      |
| `modules/auth/rbac.ts`                             | 100     | 100      | 100     | 100     |
| `modules/auth/require-auth.ts`                     | 94.54   | 91.42    | 100     | 94.33   |
| `modules/auth/scope.ts`                            | 75      | 60       | 100     | 75      |
| `modules/auth/session-store.ts`                    | 69.56   | 76.19    | 87.5    | 80      |
| `modules/auth/token-service.ts`                    | 82.75   | 66.66    | 100     | 82.75   |
| `modules/auth/username.ts`                         | 100     | 100      | 100     | 100     |
| `modules/auth/with-auth.ts`                        | 92.3    | 87.5     | 100     | 90      |
| `modules/mail/mail-service.ts`                     | 100     | 72.22    | 100     | 100     |
| `modules/mail/mail-template.ts`                    | 100     | 100      | 100     | 100     |
| `modules/mail/templates/cancel-request.ts`         | 5.55    | 0        | 0       | 5.55    |
| `modules/mail/templates/email-change-notify.ts`    | 7.69    | 0        | 0       | 7.69    |
| `modules/mail/templates/email-change-verify.ts`    | 7.69    | 0        | 0       | 7.69    |
| `modules/mail/templates/issue-created.ts`          | 5.26    | 0        | 0       | 5.26    |
| `modules/order/conflict-issue-service.ts`          | 61.6    | 36.78    | 65.51   | 64.02   |
| `modules/order/order-service.ts`                   | 77.77   | 65.71    | 100     | 82.97   |
| `modules/order/schedule-orchestrator.ts`           | 100     | 100      | 100     | 100     |
| `modules/schedule/core.ts`                         | 96.36   | 83.78    | 100     | 96.15   |
| `modules/schedule/daily-execution.ts`              | 85.71   | 75       | 100     | 85.71   |
| `modules/schedule/manual-edit-service.ts`          | 88.81   | 74.72    | 100     | 89.58   |
| `modules/schedule/preview.ts`                      | 66.66   | 50       | 100     | 66.66   |
| `modules/schedule/run.ts`                          | 80      | 66.66    | 100     | 80      |
| `modules/schedule/simulation-service.ts`           | 83.33   | 77.77    | 100     | 83.33   |
| `modules/schedule/strategy.ts`                     | 91.82   | 75.55    | 100     | 94      |
| `modules/schedule/validation-utils.ts`             | 100     | 100      | 100     | 100     |
| `modules/users/user-service.ts`                    | 98.03   | 91.11    | 100     | 98.03   |
| `modules/visualization/service.ts`                 | 63.79   | 35.71    | 64.7    | 69.38   |
| `scripts/cron.ts`                                  | 90      | 100      | 100     | 88.88   |

**說明：** `lib/generated/prisma/`_ 為產生碼，數值高屬預期；`modules/mail/templates/_`多為純字串模板，若未做 snapshot／單獨測試會偏低。補強優先順序可參考 **branch 明顯低於 stmt** 的列（例如`conflict-issues/route`、`capacity-repository`、`visualization/service`）。

---

## 與其他驗證工具的關係

| 工具                       | 用途                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `pnpm benchmark`           | `scripts/benchmark.ts`：大規模合成資料下排程 **invariant** 與效能回歸（見 `[benchmark.md](benchmark.md)`）。 |
| `pnpm lint` / `pnpm build` | 靜態檢查與 Next.js 建置，與單元測試互補。                                                                    |

若要將本文件的 coverage **表格自動更新**，可在 CI 或本機於 `pnpm test:coverage` 後用小型腳本從 `coverage/coverage-summary.json` 產生 Markdown 片段再拼入此檔。
